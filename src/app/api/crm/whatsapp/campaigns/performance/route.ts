import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWaConfig } from "@/lib/whatsapp-api";
import { getTemplateAnalytics } from "@/lib/wa-analytics";

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll() {},
      },
    }
  );
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55")) return digits;
  return `55${digits}`;
}

/**
 * Batch performance endpoint — fetches performance for multiple campaigns in
 * a single request instead of N individual requests.
 *
 * POST body: { ids: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const ids: string[] = body.ids;
    if (!ids || ids.length === 0) {
      return NextResponse.json({ results: {} });
    }

    // Cap at 20 to prevent abuse
    const campaignIds = ids.slice(0, 20);
    const admin = createAdminClient();

    // 1. Fetch all campaigns in one query (include template_id for real cost lookup)
    const { data: campaigns } = await admin
      .from("wa_campaigns")
      .select("id, started_at, completed_at, sent_count, total_messages, attribution_window_days, message_cost_usd, exchange_rate, status, template_id")
      .in("id", campaignIds)
      .eq("workspace_id", workspaceId);

    if (!campaigns || campaigns.length === 0) {
      return NextResponse.json({ results: {} });
    }

    // 2. Fetch all messages for all campaigns in one query
    const { data: allMessages } = await admin
      .from("wa_messages")
      .select("campaign_id, phone")
      .in("campaign_id", campaignIds)
      .in("status", ["sent", "delivered", "read"]);

    // Group messages by campaign_id
    const messagesByC = new Map<string, string[]>();
    for (const msg of allMessages || []) {
      const phones = messagesByC.get(msg.campaign_id) || [];
      phones.push(normalizePhone(msg.phone));
      messagesByC.set(msg.campaign_id, phones);
    }

    // 3. Determine the widest attribution window to fetch sales once
    let earliestStart: Date | null = null;
    let latestEnd: Date | null = null;

    for (const c of campaigns) {
      if (!c.started_at) continue;
      const start = new Date(c.started_at);
      const windowDays = c.attribution_window_days || 3;
      const end = new Date(start.getTime() + windowDays * 24 * 60 * 60 * 1000);
      if (!earliestStart || start < earliestStart) earliestStart = start;
      if (!latestEnd || end > latestEnd) latestEnd = end;
    }

    // Fetch sales for the entire window in one query
    let allSales: Array<{ telefone: string; valor: number; data_compra: string }> = [];
    if (earliestStart && latestEnd) {
      const { data: sales } = await admin
        .from("crm_vendas")
        .select("telefone, valor, data_compra")
        .eq("workspace_id", workspaceId)
        .gte("data_compra", earliestStart.toISOString())
        .lte("data_compra", latestEnd.toISOString());
      allSales = (sales || []) as typeof allSales;
    }

    // 4. Compute performance for each campaign
    const results: Record<string, unknown> = {};
    const now = new Date();

    for (const campaign of campaigns) {
      const windowDays = campaign.attribution_window_days || 3;
      const costUsd = campaign.message_cost_usd || 0.0625;
      const rate = campaign.exchange_rate || 5.50;
      const sentCount = campaign.sent_count || 0;

      if (!campaign.started_at) {
        results[campaign.id] = {
          conversions: 0, attributed_revenue: 0,
          total_cost_usd: 0, total_cost_brl: 0, roi_pct: 0,
          window_days: windowDays, window_active: false, window_ends_at: null,
          sent_count: sentCount,
        };
        continue;
      }

      const startedAt = new Date(campaign.started_at);
      const windowEnd = new Date(startedAt.getTime() + windowDays * 24 * 60 * 60 * 1000);
      const windowActive = now < windowEnd;
      const phoneSet = new Set(messagesByC.get(campaign.id) || []);

      let conversions = 0;
      let attributedRevenue = 0;

      if (phoneSet.size > 0) {
        for (const sale of allSales) {
          if (!sale.telefone) continue;
          const saleDate = new Date(sale.data_compra);
          if (saleDate < startedAt || saleDate > windowEnd) continue;
          if (phoneSet.has(normalizePhone(sale.telefone))) {
            conversions++;
            attributedRevenue += Number(sale.valor) || 0;
          }
        }
      }

      const totalCostUsd = sentCount * costUsd;
      const totalCostBrl = totalCostUsd * rate;
      const roiPct = totalCostBrl > 0
        ? Math.round(((attributedRevenue - totalCostBrl) / totalCostBrl) * 100)
        : 0;

      results[campaign.id] = {
        conversions,
        attributed_revenue: Math.round(attributedRevenue * 100) / 100,
        total_cost_usd: Math.round(totalCostUsd * 100) / 100,
        total_cost_brl: Math.round(totalCostBrl * 100) / 100,
        roi_pct: roiPct,
        window_days: windowDays,
        window_active: windowActive,
        window_ends_at: windowEnd.toISOString(),
        sent_count: sentCount,
      };
    }

    // 5. Try to enrich with real costs from Meta template_analytics
    await enrichWithRealCosts(admin, workspaceId, campaigns, results);

    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Fetches real costs from Meta's template_analytics API and merges them
 * into the results. Never throws — failures silently keep estimated costs.
 */
async function enrichWithRealCosts(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  campaigns: Array<{
    id: string;
    template_id: string | null;
    started_at: string | null;
    completed_at: string | null;
    exchange_rate: number | null;
  }>,
  results: Record<string, unknown>
): Promise<void> {
  try {
    // Only process campaigns started within last 90 days (API lookback limit)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const eligibleCampaigns = campaigns.filter(
      (c) => c.started_at && c.template_id && new Date(c.started_at) >= ninetyDaysAgo
    );

    if (eligibleCampaigns.length === 0) {
      // Mark all as estimated
      for (const id of Object.keys(results)) {
        const r = results[id] as Record<string, unknown>;
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
        const r = results[id] as Record<string, unknown>;
        r.cost_source = "estimated";
      }
      return;
    }

    // Get WA config for API access
    const config = await getWaConfig(workspaceId);
    if (!config) {
      for (const id of Object.keys(results)) {
        const r = results[id] as Record<string, unknown>;
        r.cost_source = "estimated";
      }
      return;
    }

    // Determine time range spanning all eligible campaigns
    let earliest = Infinity;
    let latest = 0;
    for (const c of eligibleCampaigns) {
      const start = new Date(c.started_at!).getTime() / 1000;
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
      const r = results[campaign.id] as Record<string, unknown>;
      if (!r) continue;

      const metaId = campaign.template_id ? uuidToMetaId.get(campaign.template_id) : null;
      const realCost = metaId ? metaIdToCost.get(metaId) : undefined;

      if (realCost !== undefined) {
        const rate = campaign.exchange_rate || 5.50;
        r.real_cost_usd = realCost;
        r.real_cost_brl = Math.round(realCost * rate * 100) / 100;
        r.cost_source = "meta_api";
      } else {
        r.cost_source = "estimated";
      }
    }
  } catch (err) {
    // Never let analytics failure break the endpoint
    console.error("[WA Performance] Real cost enrichment failed:", err instanceof Error ? err.message : err);
    for (const id of Object.keys(results)) {
      const r = results[id] as Record<string, unknown>;
      r.cost_source = "estimated";
    }
  }
}
