import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";

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
  // Ensure 55 prefix for BR numbers
  if (digits.startsWith("55")) return digits;
  return `55${digits}`;
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
      .select("id, started_at, completed_at, sent_count, total_messages, attribution_window_days, message_cost_usd, exchange_rate, status")
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

    // If campaign hasn't started yet, return zeroes
    if (!campaign.started_at) {
      return NextResponse.json({
        conversions: 0,
        attributed_revenue: 0,
        total_cost_usd: 0,
        total_cost_brl: 0,
        roi_pct: 0,
        window_days: windowDays,
        window_active: false,
        window_ends_at: null,
        sent_count: sentCount,
      });
    }

    const startedAt = new Date(campaign.started_at);
    const windowEnd = new Date(startedAt.getTime() + windowDays * 24 * 60 * 60 * 1000);
    const now = new Date();
    const windowActive = now < windowEnd;

    // 2. Get all phones from sent messages in this campaign
    const { data: messages } = await admin
      .from("wa_messages")
      .select("phone")
      .eq("campaign_id", id)
      .in("status", ["sent", "delivered", "read"]);

    if (!messages || messages.length === 0) {
      const totalCostUsd = sentCount * costUsd;
      const totalCostBrl = totalCostUsd * rate;
      return NextResponse.json({
        conversions: 0,
        attributed_revenue: 0,
        total_cost_usd: Math.round(totalCostUsd * 100) / 100,
        total_cost_brl: Math.round(totalCostBrl * 100) / 100,
        roi_pct: 0,
        window_days: windowDays,
        window_active: windowActive,
        window_ends_at: windowEnd.toISOString(),
        sent_count: sentCount,
      });
    }

    // Normalize all phone numbers for matching
    const phoneSet = new Set(messages.map((m) => normalizePhone(m.phone)));

    // 3. Query crm_vendas for purchases in the attribution window
    const { data: sales } = await admin
      .from("crm_vendas")
      .select("telefone, valor, data_compra")
      .eq("workspace_id", workspaceId)
      .gte("data_compra", startedAt.toISOString())
      .lte("data_compra", windowEnd.toISOString());

    // 4. Match sales to campaign phones
    let conversions = 0;
    let attributedRevenue = 0;

    if (sales) {
      for (const sale of sales) {
        if (!sale.telefone) continue;
        const normalized = normalizePhone(sale.telefone);
        if (phoneSet.has(normalized)) {
          conversions++;
          attributedRevenue += Number(sale.valor) || 0;
        }
      }
    }

    // 5. Calculate costs and ROI
    const totalCostUsd = sentCount * costUsd;
    const totalCostBrl = totalCostUsd * rate;
    const roiPct = totalCostBrl > 0
      ? Math.round(((attributedRevenue - totalCostBrl) / totalCostBrl) * 100)
      : 0;

    return NextResponse.json({
      conversions,
      attributed_revenue: Math.round(attributedRevenue * 100) / 100,
      total_cost_usd: Math.round(totalCostUsd * 100) / 100,
      total_cost_brl: Math.round(totalCostBrl * 100) / 100,
      roi_pct: roiPct,
      window_days: windowDays,
      window_active: windowActive,
      window_ends_at: windowEnd.toISOString(),
      sent_count: sentCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
