import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

// Auto-create table if it doesn't exist (idempotent)
let tableEnsured = false;
async function ensureTable() {
  if (tableEnsured) return;
  const admin = createAdminClient();
  const { error } = await admin.from("budget_logs").select("id").limit(1);
  if (!error) {
    tableEnsured = true;
    return;
  }
  tableEnsured = true;
}

const PERIOD_MS: Record<string, number> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

// GET — fetch budget logs with period filter + optional scores
export async function GET(request: NextRequest) {
  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const campaignIds = searchParams.get("campaign_ids")?.split(",").filter(Boolean) || [];
  const period = searchParams.get("period") || "7d";
  const includeScores = searchParams.get("include_scores") === "true";

  await ensureTable();
  const admin = createAdminClient();
  const ms = PERIOD_MS[period] || PERIOD_MS["7d"];
  const since = new Date(Date.now() - ms).toISOString();

  const query = admin
    .from("budget_logs")
    .select(
      "campaign_id, campaign_name, old_budget, new_budget, change_pct, tier, source, spend_at_time, roas_at_time, was_smart, risk_level, adjusted_by, adjusted_by_email, created_at"
    )
    .eq("workspace_id", workspaceId)
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (campaignIds.length > 0) {
    query.in("campaign_id", campaignIds);
  }

  const { data, error } = await query.limit(500);

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      return NextResponse.json({ logs: [], scores: null });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let scores = null;
  if (includeScores) {
    const { data: scoreData } = await admin
      .from("budget_optimization_scores")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    scores = scoreData || null;
  }

  return NextResponse.json({ logs: data || [], scores });
}

// POST — save budget adjustment logs
export async function POST(request: NextRequest) {
  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });
  }

  const body = await request.json();
  const { logs } = body as {
    logs: Array<{
      campaign_id: string;
      campaign_name?: string;
      old_budget: number;
      new_budget: number;
      change_pct: number;
      tier?: string;
      source?: string;
      spend_at_time?: number;
      roas_at_time?: number;
      was_smart?: boolean;
      risk_level?: string;
      adjusted_by?: string;
      adjusted_by_email?: string;
    }>;
  };

  if (!logs || logs.length === 0) {
    return NextResponse.json({ error: "No logs provided" }, { status: 400 });
  }

  await ensureTable();
  const admin = createAdminClient();
  const rows = logs.map((l) => ({
    workspace_id: workspaceId,
    campaign_id: l.campaign_id,
    campaign_name: l.campaign_name || null,
    old_budget: l.old_budget,
    new_budget: l.new_budget,
    change_pct: l.change_pct,
    tier: l.tier || null,
    source: l.source || "dashboard",
    spend_at_time: l.spend_at_time ?? null,
    roas_at_time: l.roas_at_time ?? null,
    was_smart: l.was_smart ?? null,
    risk_level: l.risk_level || null,
    adjusted_by: l.adjusted_by || null,
    adjusted_by_email: l.adjusted_by_email || null,
  }));

  const { error } = await admin.from("budget_logs").insert(rows);
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      console.error("[budget-logs] Table not found — run migrations 036 + 037");
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
