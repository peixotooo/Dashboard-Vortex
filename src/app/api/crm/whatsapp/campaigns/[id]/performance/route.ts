import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const maxDuration = 120;

const MESSAGE_STATUSES = ["sent", "delivered", "read", "converted"];

type TemplateComponent = {
  type: string;
  text?: string;
  format?: string;
  buttons?: Array<{ type?: string; text?: string; url?: string; phone_number?: string }>;
};

type WaTemplateDetail = {
  id: string;
  meta_id: string | null;
  name: string;
  language: string;
  category: string | null;
  status: string | null;
  components: TemplateComponent[];
  synced_at: string | null;
};

type CampaignWithTemplate = {
  id: string;
  name: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  sent_count: number | null;
  total_messages: number | null;
  attribution_window_days: number | null;
  message_cost_usd: number | null;
  exchange_rate: number | null;
  status: string | null;
  template_id: string | null;
  template_name: string | null;
  template_language: string | null;
  variable_values: Record<string, unknown> | null;
  wa_templates: WaTemplateDetail | WaTemplateDetail[] | null;
};

function normalizePhone(phone: string | null | undefined): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  // Ensure 55 prefix for BR numbers
  if (digits.startsWith("55")) return digits;
  return `55${digits}`;
}

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function formatDateLabel(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return `${day}/${month}`;
}

function getAttributionStart(campaign: {
  started_at: string | null;
  created_at: string | null;
  completed_at: string | null;
}) {
  const started = validDate(campaign.started_at);
  if (started) return { date: started, source: "started_at" };

  const created = validDate(campaign.created_at);
  if (created) return { date: created, source: "created_at" };

  const completed = validDate(campaign.completed_at);
  if (completed) return { date: completed, source: "completed_at" };

  return { date: null, source: null };
}

function buildBehaviorSeries(
  startedAt: Date,
  windowEnd: Date,
  daily: Map<string, { conversions: number; revenue: number }>,
  totalCostBrl: number
) {
  const startKey = formatDateKey(startedAt);
  const endKey = formatDateKey(windowEnd);
  const cursor = new Date(`${startKey}T12:00:00.000Z`);
  const end = new Date(`${endKey}T12:00:00.000Z`);
  const points: Array<{
    date: string;
    label: string;
    conversions: number;
    revenue: number;
    cumulative_conversions: number;
    cumulative_revenue: number;
    cumulative_roas: number;
  }> = [];

  let cumulativeConversions = 0;
  let cumulativeRevenue = 0;
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    const day = daily.get(key) || { conversions: 0, revenue: 0 };
    cumulativeConversions += day.conversions;
    cumulativeRevenue += day.revenue;
    points.push({
      date: key,
      label: formatDateLabel(key),
      conversions: day.conversions,
      revenue: round2(day.revenue),
      cumulative_conversions: cumulativeConversions,
      cumulative_revenue: round2(cumulativeRevenue),
      cumulative_roas: totalCostBrl > 0 ? round2(cumulativeRevenue / totalCostBrl) : 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return points;
}

function asRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, val == null ? "" : String(val)])
  );
}

function normalizeTemplate(template: CampaignWithTemplate["wa_templates"]): WaTemplateDetail | null {
  if (Array.isArray(template)) return template[0] || null;
  return template || null;
}

function fillTemplateVars(text: string | undefined, variables: Record<string, string>): string {
  if (!text) return "";
  return text.replace(/{{\s*(\d+)\s*}}/g, (match, index: string) => {
    return variables[`{{${index}}}`] ?? variables[index] ?? match;
  });
}

function renderTemplatePreview(
  components: TemplateComponent[],
  variables: Record<string, string>
): {
  header: string | null;
  header_format: string | null;
  body: string;
  footer: string | null;
  buttons: Array<{ text: string; url?: string; type?: string }>;
} {
  const header = components.find((component) => component.type === "HEADER");
  const body = components.find((component) => component.type === "BODY");
  const footer = components.find((component) => component.type === "FOOTER");
  const buttons = components.find((component) => component.type === "BUTTONS");

  return {
    header: header?.text ? fillTemplateVars(header.text, variables) : null,
    header_format: header?.format || null,
    body: body?.text ? fillTemplateVars(body.text, variables) : "",
    footer: footer?.text ? fillTemplateVars(footer.text, variables) : null,
    buttons: (buttons?.buttons || []).map((button) => ({
      text: fillTemplateVars(button.text || "", variables),
      url: button.url ? fillTemplateVars(button.url, variables) : undefined,
      type: button.type,
    })),
  };
}

function buildCreative(
  campaign: CampaignWithTemplate,
  sampleMessage: {
    variable_values: Record<string, unknown> | null;
    contact_name: string | null;
    status: string | null;
    sent_at: string | null;
    created_at: string | null;
  } | null
) {
  const template = normalizeTemplate(campaign.wa_templates);
  const campaignVariables = asRecord(campaign.variable_values);
  const sampleVariables = asRecord(sampleMessage?.variable_values);
  const previewVariables = Object.keys(sampleVariables).length > 0 ? sampleVariables : campaignVariables;
  const components = Array.isArray(template?.components) ? template.components : [];

  return {
    campaign_name: campaign.name,
    template_name_snapshot: campaign.template_name,
    template_language_snapshot: campaign.template_language,
    template: template
      ? {
          id: template.id,
          meta_id: template.meta_id,
          name: template.name,
          language: template.language,
          category: template.category,
          status: template.status,
          synced_at: template.synced_at,
          components,
        }
      : null,
    preview: template ? renderTemplatePreview(components, previewVariables) : null,
    variables: {
      campaign: campaignVariables,
      sample: sampleVariables,
      preview_source: Object.keys(sampleVariables).length > 0 ? "sample_message" : "campaign",
    },
    sample_message: sampleMessage
      ? {
          contact_name: sampleMessage.contact_name,
          status: sampleMessage.status,
          sent_at: sampleMessage.sent_at,
          created_at: sampleMessage.created_at,
        }
      : null,
  };
}

async function fetchPaged<T>(buildQuery: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < 500000; offset += 1000) {
    const { data, error } = await buildQuery().range(offset, offset + 999);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { id } = await params;
    const admin = createAdminClient();

    // 1. Fetch campaign
    const { data: campaign } = await admin
      .from("wa_campaigns")
      .select("id, name, started_at, completed_at, created_at, sent_count, total_messages, attribution_window_days, message_cost_usd, exchange_rate, status, template_id, template_name, template_language, variable_values, wa_templates(id, meta_id, name, language, category, status, components, synced_at)")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const typedCampaign = campaign as unknown as CampaignWithTemplate;

    const { data: sampleMessage } = await admin
      .from("wa_messages")
      .select("variable_values, contact_name, status, sent_at, created_at")
      .eq("campaign_id", id)
      .eq("workspace_id", workspaceId)
      .order("sent_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const creative = buildCreative(
      typedCampaign,
      (sampleMessage || null) as {
        variable_values: Record<string, unknown> | null;
        contact_name: string | null;
        status: string | null;
        sent_at: string | null;
        created_at: string | null;
      } | null
    );

    const windowDays = campaign.attribution_window_days || 3;
    const costUsd = campaign.message_cost_usd || 0.0625;
    const rate = campaign.exchange_rate || 5.50;
    const sentCount = campaign.sent_count || 0;
    const totalCostUsd = round2(sentCount * costUsd);
    const totalCostBrl = round2(totalCostUsd * rate);

    // Campanhas antigas podem ter sido concluídas sem preencher started_at.
    const attributionStart = getAttributionStart(campaign);
    const startedAt = attributionStart.date;

    if (!startedAt) {
      return NextResponse.json({
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
        matched_phones: 0,
        attribution_start: null,
        attribution_start_source: null,
        behavior: [],
        creative,
      });
    }

    const windowEnd = new Date(startedAt.getTime() + windowDays * 24 * 60 * 60 * 1000);
    const now = new Date();
    const windowActive = now < windowEnd;

    // 2. Get all phones from sent messages in this campaign
    const messages = await fetchPaged<{ phone: string }>(() =>
      admin
        .from("wa_messages")
        .select("phone")
        .eq("campaign_id", id)
        .in("status", MESSAGE_STATUSES)
    );

    if (messages.length === 0) {
      return NextResponse.json({
        conversions: 0,
        attributed_revenue: 0,
        total_cost_usd: totalCostUsd,
        total_cost_brl: totalCostBrl,
        roi_pct: 0,
        roas: 0,
        window_days: windowDays,
        window_active: windowActive,
        window_ends_at: windowEnd.toISOString(),
        sent_count: sentCount,
        matched_phones: 0,
        attribution_start: startedAt.toISOString(),
        attribution_start_source: attributionStart.source,
        behavior: buildBehaviorSeries(startedAt, windowEnd, new Map(), totalCostBrl),
        creative,
      });
    }

    // Normalize all phone numbers for matching
    const phoneSet = new Set(messages.map((m) => normalizePhone(m.phone)).filter(Boolean));

    // 3. Query crm_vendas for purchases in the attribution window
    const sales = await fetchPaged<{ telefone: string | null; valor: number | null; data_compra: string }>(() =>
      admin
        .from("crm_vendas")
        .select("telefone, valor, data_compra")
        .eq("workspace_id", workspaceId)
        .gte("data_compra", startedAt.toISOString())
        .lte("data_compra", windowEnd.toISOString())
    );

    // 4. Match sales to campaign phones
    let conversions = 0;
    let attributedRevenue = 0;
    const daily = new Map<string, { conversions: number; revenue: number }>();

    for (const sale of sales) {
      const normalized = normalizePhone(sale.telefone);
      if (normalized && phoneSet.has(normalized)) {
        const saleDate = validDate(sale.data_compra);
        if (!saleDate) continue;
        const key = formatDateKey(saleDate);
        const day = daily.get(key) || { conversions: 0, revenue: 0 };
        day.conversions += 1;
        day.revenue += Number(sale.valor) || 0;
        daily.set(key, day);
        conversions++;
        attributedRevenue += Number(sale.valor) || 0;
      }
    }

    // 5. Calculate costs and ROI
    const roiPct = totalCostBrl > 0
      ? Math.round(((attributedRevenue - totalCostBrl) / totalCostBrl) * 100)
      : 0;
    const revenue = round2(attributedRevenue);

    return NextResponse.json({
      conversions,
      attributed_revenue: revenue,
      total_cost_usd: totalCostUsd,
      total_cost_brl: totalCostBrl,
      roi_pct: roiPct,
      roas: totalCostBrl > 0 ? round2(revenue / totalCostBrl) : 0,
      window_days: windowDays,
      window_active: windowActive,
      window_ends_at: windowEnd.toISOString(),
      sent_count: sentCount,
      matched_phones: phoneSet.size,
      attribution_start: startedAt.toISOString(),
      attribution_start_source: attributionStart.source,
      behavior: buildBehaviorSeries(startedAt, windowEnd, daily, totalCostBrl),
      creative,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
