import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWaConfig } from "@/lib/whatsapp-api";
import { getTemplateAnalytics } from "@/lib/wa-analytics";

export const maxDuration = 120;

type CampaignRow = {
  id: string;
  name?: string | null;
  status: string | null;
  total_messages?: number | null;
  sent_count: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  attribution_window_days: number | null;
  message_cost_usd: number | null;
  exchange_rate: number | null;
  template_id: string | null;
  wa_templates?: { name: string; language: string } | null;
};

type PerformanceResult = {
  conversions: number;
  attributed_revenue: number;
  total_cost_usd: number;
  total_cost_brl: number;
  roi_pct: number;
  roas: number;
  window_days: number;
  window_active: boolean;
  window_ends_at: string | null;
  sent_count: number;
  attribution_start: string | null;
  attribution_start_source: "started_at" | "created_at" | "completed_at" | null;
  matched_phones: number;
  real_cost_usd?: number;
  real_cost_brl?: number;
  cost_source?: "meta_api" | "estimated";
};

const MESSAGE_STATUSES = ["sent", "delivered", "read", "converted"];

function normalizePhone(phone: string | null | undefined): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55")) return digits;
  return `55${digits}`;
}

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function getAttributionStart(campaign: Pick<CampaignRow, "started_at" | "created_at" | "completed_at">): {
  date: Date | null;
  source: PerformanceResult["attribution_start_source"];
} {
  const started = validDate(campaign.started_at);
  if (started) return { date: started, source: "started_at" };

  // Campanhas antigas podem ter sido concluídas sem preencher started_at.
  // created_at é o melhor proxy para o início do disparo nesses casos.
  const created = validDate(campaign.created_at);
  if (created) return { date: created, source: "created_at" };

  const completed = validDate(campaign.completed_at);
  if (completed) return { date: completed, source: "completed_at" };

  return { date: null, source: null };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function fetchPaged<T>(
  buildQuery: () => any,
  opts: { pageSize?: number; hardCap?: number } = {}
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 1000;
  const hardCap = opts.hardCap ?? 500000;
  const out: T[] = [];

  for (let offset = 0; offset < hardCap; offset += pageSize) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }

  return out;
}

async function computeCampaignPerformance(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  campaigns: CampaignRow[]
): Promise<Record<string, PerformanceResult>> {
  const campaignIds = campaigns.map((c) => c.id);
  const results: Record<string, PerformanceResult> = {};
  if (campaignIds.length === 0) return results;

  const allMessages = await fetchPaged<{ campaign_id: string; phone: string }>(() =>
    admin
      .from("wa_messages")
      .select("campaign_id, phone")
      .in("campaign_id", campaignIds)
      .in("status", MESSAGE_STATUSES)
  );

  const phonesByCampaign = new Map<string, Set<string>>();
  for (const msg of allMessages) {
    const normalized = normalizePhone(msg.phone);
    if (!normalized) continue;
    if (!phonesByCampaign.has(msg.campaign_id)) phonesByCampaign.set(msg.campaign_id, new Set());
    phonesByCampaign.get(msg.campaign_id)!.add(normalized);
  }

  let earliestStart: Date | null = null;
  let latestEnd: Date | null = null;
  const startByCampaign = new Map<string, { date: Date | null; source: PerformanceResult["attribution_start_source"] }>();

  for (const campaign of campaigns) {
    const start = getAttributionStart(campaign);
    startByCampaign.set(campaign.id, start);
    if (!start.date) continue;

    const windowDays = campaign.attribution_window_days || 3;
    const end = new Date(start.date.getTime() + windowDays * 24 * 60 * 60 * 1000);
    if (!earliestStart || start.date < earliestStart) earliestStart = start.date;
    if (!latestEnd || end > latestEnd) latestEnd = end;
  }

  const allSales = earliestStart && latestEnd
    ? await fetchPaged<{ telefone: string | null; valor: number | null; data_compra: string }>(() =>
        admin
          .from("crm_vendas")
          .select("telefone, valor, data_compra")
          .eq("workspace_id", workspaceId)
          .gte("data_compra", earliestStart!.toISOString())
          .lte("data_compra", latestEnd!.toISOString())
      )
    : [];

  const now = new Date();

  for (const campaign of campaigns) {
    const windowDays = campaign.attribution_window_days || 3;
    const costUsd = Number(campaign.message_cost_usd || 0.0625);
    const rate = Number(campaign.exchange_rate || 5.50);
    const sentCount = Number(campaign.sent_count || 0);
    const totalCostUsd = round2(sentCount * costUsd);
    const totalCostBrl = round2(totalCostUsd * rate);
    const start = startByCampaign.get(campaign.id) || { date: null, source: null };

    if (!start.date) {
      results[campaign.id] = {
        conversions: 0,
        attributed_revenue: 0,
        total_cost_usd: totalCostUsd,
        total_cost_brl: totalCostBrl,
        roi_pct: 0,
        roas: 0,
        window_days: windowDays,
        window_active: false,
        window_ends_at: null,
        sent_count: sentCount,
        attribution_start: null,
        attribution_start_source: null,
        matched_phones: phonesByCampaign.get(campaign.id)?.size || 0,
      };
      continue;
    }

    const windowEnd = new Date(start.date.getTime() + windowDays * 24 * 60 * 60 * 1000);
    const phoneSet = phonesByCampaign.get(campaign.id) || new Set<string>();
    let conversions = 0;
    let attributedRevenue = 0;

    if (phoneSet.size > 0) {
      for (const sale of allSales) {
        const saleDate = validDate(sale.data_compra);
        if (!saleDate || saleDate < start.date || saleDate > windowEnd) continue;
        if (phoneSet.has(normalizePhone(sale.telefone))) {
          conversions += 1;
          attributedRevenue += Number(sale.valor) || 0;
        }
      }
    }

    const revenue = round2(attributedRevenue);
    results[campaign.id] = {
      conversions,
      attributed_revenue: revenue,
      total_cost_usd: totalCostUsd,
      total_cost_brl: totalCostBrl,
      roi_pct: totalCostBrl > 0 ? Math.round(((revenue - totalCostBrl) / totalCostBrl) * 100) : 0,
      roas: totalCostBrl > 0 ? round2(revenue / totalCostBrl) : 0,
      window_days: windowDays,
      window_active: now < windowEnd,
      window_ends_at: windowEnd.toISOString(),
      sent_count: sentCount,
      attribution_start: start.date.toISOString(),
      attribution_start_source: start.source,
      matched_phones: phoneSet.size,
    };
  }

  return results;
}

function summarizePerformance(results: Record<string, PerformanceResult>) {
  const rows = Object.values(results);
  const attributedRevenue = rows.reduce((sum, r) => sum + r.attributed_revenue, 0);
  const totalCostBrl = rows.reduce((sum, r) => sum + (r.real_cost_brl ?? r.total_cost_brl), 0);
  const conversions = rows.reduce((sum, r) => sum + r.conversions, 0);
  const sent = rows.reduce((sum, r) => sum + r.sent_count, 0);

  return {
    campaigns: rows.length,
    sent,
    conversions,
    attributed_revenue: round2(attributedRevenue),
    total_cost_brl: round2(totalCostBrl),
    roas: totalCostBrl > 0 ? round2(attributedRevenue / totalCostBrl) : 0,
    roi_pct: totalCostBrl > 0 ? Math.round(((attributedRevenue - totalCostBrl) / totalCostBrl) * 100) : 0,
    revenue_per_sent: sent > 0 ? round2(attributedRevenue / sent) : 0,
  };
}

/**
 * Batch performance endpoint — fetches performance for multiple campaigns in
 * a single request instead of N individual requests.
 *
 * POST body: { ids: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const body = await request.json().catch(() => ({}));
    const ids: string[] = body.ids;
    if (!ids || ids.length === 0) {
      return NextResponse.json({ results: {} });
    }

    const campaignIds = [...new Set(ids)].slice(0, 100);
    const admin = createAdminClient();

    // 1. Fetch all campaigns in one query (include template_id for real cost lookup)
    const { data: campaigns } = await admin
      .from("wa_campaigns")
      .select("id, name, status, total_messages, sent_count, started_at, completed_at, created_at, attribution_window_days, message_cost_usd, exchange_rate, template_id")
      .in("id", campaignIds)
      .eq("workspace_id", workspaceId);

    if (!campaigns || campaigns.length === 0) {
      return NextResponse.json({ results: {} });
    }

    const results = await computeCampaignPerformance(admin, workspaceId, campaigns as CampaignRow[]);

    // 5. Try to enrich with real costs from Meta template_analytics
    await enrichWithRealCosts(admin, workspaceId, campaigns as CampaignRow[], results);

    return NextResponse.json({ results });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();
    const params = request.nextUrl.searchParams;
    const limit = Math.min(100, Math.max(1, Number(params.get("limit") || 100)));
    const days = Math.min(365, Math.max(0, Number(params.get("days") || 90)));

    let query = admin
      .from("wa_campaigns")
      .select("id, name, status, total_messages, sent_count, started_at, completed_at, created_at, attribution_window_days, message_cost_usd, exchange_rate, template_id, wa_templates(name, language)")
      .eq("workspace_id", workspaceId)
      .eq("kind", "campaign")
      .in("status", ["completed", "sending", "failed"]);

    if (days > 0) {
      const since = new Date();
      since.setDate(since.getDate() - days);
      query = query.gte("created_at", since.toISOString());
    }

    const { data: campaigns, error } = await query
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!campaigns || campaigns.length === 0) {
      return NextResponse.json({ campaigns: [], summary: summarizePerformance({}) });
    }

    const rows = campaigns as unknown as CampaignRow[];
    const results = await computeCampaignPerformance(admin, workspaceId, rows);
    await enrichWithRealCosts(admin, workspaceId, rows, results);

    const reportRows = rows.map((campaign) => ({
      campaign,
      performance: results[campaign.id],
    }));

    return NextResponse.json({
      campaigns: reportRows,
      summary: summarizePerformance(results),
      period: { days, limit },
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

/**
 * Fetches real costs from Meta's template_analytics API and merges them
 * into the results. Never throws — failures silently keep estimated costs.
 */
async function enrichWithRealCosts(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  campaigns: CampaignRow[],
  results: Record<string, PerformanceResult>
): Promise<void> {
  try {
    // Only process campaigns started within last 90 days (API lookback limit)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const eligibleCampaigns = campaigns.filter((c) => {
      const start = getAttributionStart(c).date;
      return start && c.template_id && start >= ninetyDaysAgo;
    });

    if (eligibleCampaigns.length === 0) {
      // Mark all as estimated
      for (const id of Object.keys(results)) {
        const r = results[id];
        r.cost_source = "estimated";
      }
      return;
    }

    // Get Meta template IDs (numeric) from wa_templates
    const templateUuids = [...new Set(eligibleCampaigns.map((c) => c.template_id!))];
    const { data: templates } = await admin
      .from("wa_templates")
      .select("id, meta_id")
      .in("id", templateUuids);

    const uuidToMetaId = new Map<string, string>();
    for (const t of templates || []) {
      if (t.meta_id) uuidToMetaId.set(t.id, t.meta_id);
    }

    if (uuidToMetaId.size === 0) {
      for (const id of Object.keys(results)) {
        const r = results[id];
        r.cost_source = "estimated";
      }
      return;
    }

    // Get WA config for API access
    const config = await getWaConfig(workspaceId);
    if (!config) {
      for (const id of Object.keys(results)) {
        const r = results[id];
        r.cost_source = "estimated";
      }
      return;
    }

    // Determine time range spanning all eligible campaigns
    let earliest = Infinity;
    let latest = 0;
    for (const c of eligibleCampaigns) {
      const startDate = getAttributionStart(c).date;
      if (!startDate) continue;
      const start = startDate.getTime() / 1000;
      const end = c.completed_at
        ? new Date(c.completed_at).getTime() / 1000
        : Math.floor(Date.now() / 1000);
      if (start < earliest) earliest = start;
      if (end > latest) latest = end;
    }

    // Fetch template analytics from Meta (up to 10 template IDs per call)
    const metaIds = [...new Set(uuidToMetaId.values())].map(Number).filter((n) => !isNaN(n));
    const metrics = await getTemplateAnalytics(config.wabaId, config.accessToken, {
      startTimestamp: Math.floor(earliest),
      endTimestamp: Math.floor(latest) + 86400, // +1 day buffer
      templateIds: metaIds.slice(0, 10),
    });

    // Map: metaId → costUsd
    const metaIdToCost = new Map<string, number>();
    for (const m of metrics) {
      metaIdToCost.set(m.templateId, m.costUsd);
    }

    // Enrich results
    for (const campaign of campaigns) {
      const r = results[campaign.id];
      if (!r) continue;

      const metaId = campaign.template_id ? uuidToMetaId.get(campaign.template_id) : null;
      const realCost = metaId ? metaIdToCost.get(metaId) : undefined;

      if (realCost !== undefined) {
        const rate = campaign.exchange_rate || 5.50;
        r.real_cost_usd = realCost;
        r.real_cost_brl = round2(realCost * rate);
        r.roas = r.real_cost_brl > 0 ? round2(r.attributed_revenue / r.real_cost_brl) : 0;
        r.roi_pct = r.real_cost_brl > 0
          ? Math.round(((r.attributed_revenue - r.real_cost_brl) / r.real_cost_brl) * 100)
          : 0;
        r.cost_source = "meta_api";
      } else {
        r.cost_source = "estimated";
      }
    }
  } catch (err) {
    // Never let analytics failure break the endpoint
    console.error("[WA Performance] Real cost enrichment failed:", err instanceof Error ? err.message : err);
    for (const id of Object.keys(results)) {
      const r = results[id];
      r.cost_source = "estimated";
    }
  }
}
