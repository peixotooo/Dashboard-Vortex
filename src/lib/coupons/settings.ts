import { createAdminClient } from "@/lib/supabase-admin";

export interface CouponWorkspaceSettings {
  global_max_discount_pct: number;
  global_max_active_coupons: number;
  pending_approval_ttl_hours: number;
  default_uses_per_code: number;
  default_uses_per_user: number;
  cumulative_with_other_promos: boolean;
  notify_on_creation: boolean;
  notify_on_failure: boolean;
}

const DEFAULT_SETTINGS: CouponWorkspaceSettings = {
  global_max_discount_pct: 25,
  global_max_active_coupons: 30,
  pending_approval_ttl_hours: 48,
  default_uses_per_code: 100,
  default_uses_per_user: 1,
  cumulative_with_other_promos: false,
  notify_on_creation: true,
  notify_on_failure: true,
};

/**
 * Returns workspace coupon settings, creating a default row if missing.
 * Always returns sane values — callers can rely on every field being defined.
 */
export async function getCouponSettings(workspaceId: string): Promise<CouponWorkspaceSettings> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("coupon_workspace_settings")
    .select(
      "global_max_discount_pct, global_max_active_coupons, pending_approval_ttl_hours, default_uses_per_code, default_uses_per_user, cumulative_with_other_promos, notify_on_creation, notify_on_failure"
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) return { ...DEFAULT_SETTINGS };
  return {
    global_max_discount_pct: Number(data.global_max_discount_pct),
    global_max_active_coupons: Number(data.global_max_active_coupons),
    pending_approval_ttl_hours: Number(data.pending_approval_ttl_hours),
    default_uses_per_code: Number(data.default_uses_per_code),
    default_uses_per_user: Number(data.default_uses_per_user),
    cumulative_with_other_promos: !!data.cumulative_with_other_promos,
    notify_on_creation: !!data.notify_on_creation,
    notify_on_failure: !!data.notify_on_failure,
  };
}

export async function upsertCouponSettings(
  workspaceId: string,
  patch: Partial<CouponWorkspaceSettings>
): Promise<CouponWorkspaceSettings> {
  const admin = createAdminClient();
  const current = await getCouponSettings(workspaceId);
  const next = { ...current, ...patch };

  // Sanity guards
  if (next.global_max_discount_pct <= 0 || next.global_max_discount_pct > 80) {
    throw new Error("global_max_discount_pct must be between 0 and 80");
  }
  if (next.global_max_active_coupons <= 0 || next.global_max_active_coupons > 200) {
    throw new Error("global_max_active_coupons must be between 1 and 200");
  }

  const { error } = await admin
    .from("coupon_workspace_settings")
    .upsert({ workspace_id: workspaceId, ...next, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return next;
}
