// src/app/api/crm/email-templates/reports/route.ts
//
// Lists every dispatch the workspace has fired, joined with the latest
// stats snapshot from email_template_dispatches.stats. Used by the
// Reports dashboard.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const url = new URL(req.url);
    const days = Math.min(
      Math.max(parseInt(url.searchParams.get("days") ?? "30", 10) || 30, 1),
      365
    );
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const sb = createAdminClient();
    const { data, error } = await sb
      .from("email_template_dispatches")
      .select(
        "id, workspace_id, draft_id, suggestion_id, locaweb_message_id, locaweb_list_ids, scheduled_to, status, stats, last_synced_at, created_at"
      )
      .eq("workspace_id", workspaceId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ dispatches: data ?? [] });
  } catch (err) {
    return handleAuthError(err);
  }
}
