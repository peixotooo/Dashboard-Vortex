import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { buildCartRecoveryJourneyPayload } from "@/lib/cart-recovery/journey-service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: rules, error } = await admin
    .from("cart_recovery_rules")
    .select("workspace_id")
    .order("updated_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{
    workspace_id: string;
    carts?: number;
    mode?: string;
    pilot?: { eligible: number; control: number; pilot: number; queued: number };
    error?: string;
  }> = [];

  for (const row of rules || []) {
    try {
      const payload = await buildCartRecoveryJourneyPayload({
        admin,
        workspaceId: row.workspace_id,
        limit: 200,
        persist: true,
      });
      results.push({
        workspace_id: row.workspace_id,
        carts: payload.summary.carts,
        mode: payload.mode,
        pilot: payload.pilot,
      });
    } catch (cause) {
      results.push({
        workspace_id: row.workspace_id,
        error: cause instanceof Error ? cause.message : "Unknown error",
      });
    }
  }

  const failed = results.filter((result) => result.error).length;
  return NextResponse.json({
    ok: failed === 0,
    workspaces: results.length,
    failed,
    carts: results.reduce((sum, result) => sum + (result.carts || 0), 0),
    results,
  });
}
