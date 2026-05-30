import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";

export const maxDuration = 120;

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

const MESSAGE_STATUSES = ["sent", "delivered", "read", "converted"];

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
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const { id } = await params;
    const admin = createAdminClient();

    // 1. Fetch campaign
    const { data: campaign } = await admin
      .from("wa_campaigns")
      .select("id, started_at, completed_at, created_at, sent_count, total_messages, attribution_window_days, message_cost_usd, exchange_rate, status")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const windowDays = campaign.attribution_window_days || 3;
    const costUsd = campaign.message_cost_usd || 0.0625;
    const rate = campaign.exchange_rate || 5.50;
    const sentCount = campaign.sent_count || 0;
    const totalCostUsd = round2(sentCount * costUsd);
    const totalCostBrl = round2(totalCostUsd * rate);

    // Campanhas antigas podem ter sido concluídas sem preencher started_at.
    const startedAt =
      validDate(campaign.started_at) ||
      validDate(campaign.created_at) ||
      validDate(campaign.completed_at);

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

    for (const sale of sales) {
      const normalized = normalizePhone(sale.telefone);
      if (normalized && phoneSet.has(normalized)) {
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
