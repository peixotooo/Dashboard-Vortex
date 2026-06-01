import { NextRequest, NextResponse } from "next/server";
import { importMissingCartsFromVnda } from "@/lib/cart-recovery/vnda-import";
import { createAdminClient } from "@/lib/supabase-admin";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const hours = Math.max(
    1,
    Math.min(168, Number(process.env.CART_RECOVERY_IMPORT_WINDOW_HOURS) || 72)
  );

  try {
    const { data: rules, error } = await admin
      .from("cart_recovery_rules")
      .select("workspace_id")
      .eq("enabled", true);

    if (error) {
      console.error("[CartRecovery Import Cron]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const workspaceIds = Array.from(
      new Set((rules || []).map((r) => r.workspace_id as string))
    );

    if (workspaceIds.length === 0) {
      return NextResponse.json({ processed: 0, message: "No active rules" });
    }

    const summary: Array<{
      workspaceId: string;
      fetched: number;
      eligible: number;
      imported: number;
      skipped_existing: number;
      skipped_invalid: number;
      skipped_converted: number;
      skipped_no_email: number;
      errors: number;
      error?: string;
    }> = [];

    for (const workspaceId of workspaceIds) {
      try {
        const stats = await importMissingCartsFromVnda({
          admin,
          workspaceId,
          hours,
          maxPages: 5,
          perPage: 100,
          rateLimitMs: 150,
        });

        summary.push({
          workspaceId,
          fetched: stats.fetched,
          eligible: stats.eligible,
          imported: stats.imported,
          skipped_existing: stats.skipped_existing,
          skipped_invalid: stats.skipped_invalid,
          skipped_converted: stats.skipped_converted,
          skipped_no_email: stats.skipped_no_email,
          errors: stats.errors,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.push({
          workspaceId,
          fetched: 0,
          eligible: 0,
          imported: 0,
          skipped_existing: 0,
          skipped_invalid: 0,
          skipped_converted: 0,
          skipped_no_email: 0,
          errors: 1,
          error: message,
        });
        console.error(
          `[CartRecovery Import Cron] ws=${workspaceId} failed:`,
          message
        );
      }
    }

    return NextResponse.json({
      processed: summary.length,
      window_hours: hours,
      summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[CartRecovery Import Cron]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
