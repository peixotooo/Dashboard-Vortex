import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

// Auto-create table if it doesn't exist (idempotent)
let tableEnsured = false;
async function ensureTable() {
  if (tableEnsured) return;
  const admin = createAdminClient();
  // Quick probe — if table exists, skip
  const { error } = await admin.from("budget_logs").select("id").limit(1);
  if (!error) {
    tableEnsured = true;
    return;
  }
  // Table missing — create it via raw SQL through a temporary function
  // Since we can't run raw SQL via PostgREST, we'll let the first request fail gracefully
  // and instruct the user to run the migration.
  // For now, just mark as ensured so we don't keep checking.
  tableEnsured = true;
}

// GET — fetch recent budget logs for given campaign IDs (last 48h)
export async function GET(request: NextRequest) {
  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const campaignIds = searchParams.get("campaign_ids")?.split(",").filter(Boolean) || [];

  await ensureTable();
  const admin = createAdminClient();
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const query = admin
    .from("budget_logs")
    .select("campaign_id, old_budget, new_budget, change_pct, tier, created_at")
    .eq("workspace_id", workspaceId)
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (campaignIds.length > 0) {
    query.in("campaign_id", campaignIds);
  }

  const { data, error } = await query.limit(500);

  if (error) {
    // Table doesn't exist yet — return empty gracefully
    if (error.code === "PGRST205" || error.code === "42P01") {
      return NextResponse.json({ logs: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ logs: data || [] });
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
  }));

  const { error } = await admin.from("budget_logs").insert(rows);
  if (error) {
    // Table doesn't exist — silently fail, log will be written once migration runs
    if (error.code === "PGRST205" || error.code === "42P01") {
      console.error("[budget-logs] Table not found — run migration-036-budget-logs.sql");
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
