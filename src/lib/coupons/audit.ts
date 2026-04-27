import { createAdminClient } from "@/lib/supabase-admin";

export type AuditAction =
  | "plan_created" | "plan_updated" | "plan_disabled"
  | "cron_picked" | "cron_skipped"
  | "approved" | "rejected" | "auto_expired"
  | "vnda_create_attempt" | "vnda_create_ok" | "vnda_create_fail"
  | "vnda_pause_attempt" | "vnda_pause_ok" | "vnda_pause_fail"
  | "product_out_of_stock" | "product_inactive"
  | "manual_pause" | "manual_resume"
  | "attribution_synced" | "bandit_recomputed" | "bucket_reused";

export interface AuditEntry {
  workspaceId: string;
  action: AuditAction;
  actor?: string;
  planId?: string;
  activeCouponId?: string;
  productId?: string;
  details?: Record<string, unknown>;
  errorMessage?: string;
}

export async function logCouponAudit(entry: AuditEntry): Promise<void> {
  const admin = createAdminClient();
  await admin.from("coupon_audit_log").insert({
    workspace_id: entry.workspaceId,
    plan_id: entry.planId || null,
    active_coupon_id: entry.activeCouponId || null,
    action: entry.action,
    actor: entry.actor || "system",
    product_id: entry.productId || null,
    details: entry.details || {},
    error_message: entry.errorMessage || null,
  });
}
