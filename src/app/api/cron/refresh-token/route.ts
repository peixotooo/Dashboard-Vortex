import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { ml } from "@/lib/ml/client";

export const maxDuration = 30;

/**
 * GET — Cron: Proactively refresh ML tokens that are close to expiring.
 * This prevents token expiry during normal operations.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Find all ML credentials
  const { data: credentials } = await supabase
    .from("ml_credentials")
    .select("workspace_id, expires_at");

  if (!credentials || credentials.length === 0) {
    return NextResponse.json({ message: "No ML credentials", refreshed: 0 });
  }

  let refreshed = 0;
  const errors: Array<{ workspace_id: string; error: string }> = [];

  for (const cred of credentials) {
    const expiresAt = new Date(cred.expires_at);
    // Refresh if < 2 hours until expiry
    if (expiresAt.getTime() - Date.now() < 2 * 60 * 60 * 1000) {
      try {
        // getToken will auto-refresh if < 30min, but we want to be proactive
        await ml.getToken(cred.workspace_id);
        refreshed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erro";
        errors.push({ workspace_id: cred.workspace_id, error: message });
      }
    }
  }

  return NextResponse.json({ refreshed, errors });
}
