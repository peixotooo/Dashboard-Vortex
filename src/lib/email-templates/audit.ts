// src/lib/email-templates/audit.ts
import { createAdminClient } from "@/lib/supabase-admin";

export type AuditEvent =
  | "generated"
  | "skipped_no_product"
  | "skipped_no_ga4"
  | "skipped_no_vnda"
  | "copy_failed"
  | "coupon_created"
  | "coupon_failed"
  | "render_failed"
  | "selected"
  | "sent";

export async function logAudit(args: {
  workspace_id: string;
  suggestion_id?: string | null;
  event: AuditEvent;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("email_template_audit").insert({
    workspace_id: args.workspace_id,
    suggestion_id: args.suggestion_id ?? null,
    event: args.event,
    payload: args.payload ?? null,
  });
}

export async function listRecentAudit(workspace_id: string, hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("email_template_audit")
    .select("*")
    .eq("workspace_id", workspace_id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);
  return data ?? [];
}
