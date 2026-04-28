// VNDA coupon API helpers — POST /discounts → /rules → /coupons + PATCH pause.
// Mirrors the auth pattern from src/lib/vnda-api.ts.

import { createAdminClient } from "@/lib/supabase-admin";
import { decrypt } from "@/lib/encryption";

export interface VndaConfig {
  apiToken: string;
  storeHost: string;
}

interface VndaErrorPayload {
  error?: unknown;
  errors?: unknown;
  message?: string;
}

class VndaError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`VNDA ${status}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

async function vndaWrite<T>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  config: VndaConfig,
  body?: Record<string, unknown>
): Promise<T> {
  const url = `https://api.vnda.com.br/api/v2/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Shop-Host": config.storeHost,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new VndaError(res.status, text);
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

export async function getVndaConfigForWorkspace(workspaceId: string): Promise<VndaConfig | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("vnda_connections")
    .select("api_token, store_host")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (data?.api_token && data?.store_host) {
    return { apiToken: decrypt(data.api_token), storeHost: data.store_host as string };
  }
  return null;
}

// --- Promotion (parent container) ---

export interface VndaPromotion {
  id: number;
  name: string;
  enabled: boolean;
  start_at: string;
  end_at: string | null;
  cumulative: boolean;
  valid_to: string;
}

export async function createVndaPromotion(
  config: VndaConfig,
  args: {
    name: string;
    starts_at: Date;
    expires_at: Date;
    cumulative?: boolean;
    description?: string;
  }
): Promise<VndaPromotion> {
  return vndaWrite<VndaPromotion>("POST", "discounts/", config, {
    name: args.name,
    start_at: args.starts_at.toISOString(),
    end_at: args.expires_at.toISOString(),
    enabled: true,
    cumulative: args.cumulative ?? false,
    valid_to: "cart",
    description: args.description || "",
  });
}

export async function pauseVndaPromotion(config: VndaConfig, promotionId: number): Promise<void> {
  await vndaWrite("PATCH", `discounts/${promotionId}`, config, { enabled: false });
}

export async function resumeVndaPromotion(config: VndaConfig, promotionId: number): Promise<void> {
  await vndaWrite("PATCH", `discounts/${promotionId}`, config, { enabled: true });
}

// --- Rule (links a promotion to a specific product + discount %) ---

export interface VndaRule {
  id: number;
  product_id: number;
  apply_to: string;
  amount_type: string;
  amount: number;
}

/**
 * Removes a single product binding (rule) from a discount. Used to "pause"
 * a coupon in a bucket setup where multiple products share the same
 * vnda_discount_id — disabling the parent discount would kill the whole
 * bucket, so we surgically detach just the affected product.
 *
 * Returns true on 204/200/404 (idempotent: missing rule = already detached).
 */
export async function removeVndaProductRule(
  config: VndaConfig,
  promotionId: number,
  ruleId: number
): Promise<boolean> {
  const url = `https://api.vnda.com.br/api/v2/discounts/${promotionId}/rules/${ruleId}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      Accept: "application/json",
      "X-Shop-Host": config.storeHost,
    },
  });
  if (res.status === 404) return true;
  if (!res.ok) {
    const text = await res.text();
    throw new VndaError(res.status, text);
  }
  return true;
}

export async function createVndaProductRule(
  config: VndaConfig,
  promotionId: number,
  args: {
    product_id: string | number;
    /** Discount magnitude. Interpreted as % when discount_unit='pct',
     * as BRL absolute amount when 'brl'. */
    amount: number;
    /** 'pct' = percentage off, 'brl' = absolute Reais off. Default 'pct'. */
    discount_unit?: "pct" | "brl";
  }
): Promise<VndaRule> {
  const productIdNum = typeof args.product_id === "string" ? parseInt(args.product_id, 10) : args.product_id;
  if (!Number.isFinite(productIdNum)) {
    throw new Error(`Invalid product_id: ${args.product_id}`);
  }
  const amountType = args.discount_unit === "brl" ? "R$" : "%";
  return vndaWrite<VndaRule>("POST", `discounts/${promotionId}/rules/`, config, {
    product_id: productIdNum,
    apply_to: "product",
    amount_type: amountType,
    amount: args.amount,
  });
}

// --- Coupon code (the string customers type at checkout) ---

export interface VndaCoupon {
  id: number;
  code: string;
  uses_per_code: number | null;
  uses_per_user: number | null;
}

export async function createVndaCoupon(
  config: VndaConfig,
  promotionId: number,
  args: {
    code: string;
    uses_per_code: number;
    uses_per_user: number;
  }
): Promise<VndaCoupon> {
  return vndaWrite<VndaCoupon>("POST", `discounts/${promotionId}/coupons/`, config, {
    code: args.code,
    uses_per_code: args.uses_per_code,
    uses_per_user: args.uses_per_user,
  });
}

// --- Bucket helpers — many codes per promotion ---
// VNDA supports N rules and N coupon codes per promotion. To reduce promotion
// clutter on their side, the orchestrator can group all coupons from a single
// cron run into ONE bucket (one parent promotion). createPromotionBucket() makes
// the empty parent and addCodeToBucket() appends each (rule + code) pair.
//
// Pause = pausing the parent disables ALL codes inside, so buckets must group
// coupons that share the SAME starts_at + expires_at + cumulative settings.

export async function createPromotionBucket(
  config: VndaConfig,
  args: {
    name: string;
    starts_at: Date;
    expires_at: Date;
    cumulative?: boolean;
    description?: string;
  }
): Promise<VndaPromotion> {
  return createVndaPromotion(config, args);
}

export interface AddCodeToBucketResult {
  rule_id: number;
  coupon_id: number;
  coupon_code: string;
}

export async function addCodeToBucket(
  config: VndaConfig,
  promotionId: number,
  args: {
    code: string;
    product_id: string | number;
    amount: number;
    discount_unit: "pct" | "brl";
    uses_per_code: number;
    uses_per_user: number;
  }
): Promise<AddCodeToBucketResult> {
  const rule = await createVndaProductRule(config, promotionId, {
    product_id: args.product_id,
    amount: args.amount,
    discount_unit: args.discount_unit,
  });
  const coupon = await createVndaCoupon(config, promotionId, {
    code: args.code,
    uses_per_code: args.uses_per_code,
    uses_per_user: args.uses_per_user,
  });
  return { rule_id: rule.id, coupon_id: coupon.id, coupon_code: coupon.code };
}

// --- Composite: create promotion + rule + coupon in one call ---
// Used by the orchestrator after manual approval. Returns IDs we need to
// store in promo_active_coupons. Rolls back the promotion if any step fails.

export interface CreateFullCouponResult {
  promotion_id: number;
  rule_id: number;
  coupon_id: number;
  coupon_code: string;
  starts_at: Date;
  expires_at: Date;
}

export async function createFullCoupon(
  config: VndaConfig,
  args: {
    name: string;
    code: string;
    product_id: string | number;
    /** Discount magnitude. Pct (0-100) or absolute BRL amount. */
    amount: number;
    /** Default 'pct' for backwards compatibility. */
    discount_unit?: "pct" | "brl";
    starts_at: Date;
    expires_at: Date;
    cumulative: boolean;
    uses_per_code: number;
    uses_per_user: number;
  }
): Promise<CreateFullCouponResult> {
  const promo = await createVndaPromotion(config, {
    name: args.name,
    starts_at: args.starts_at,
    expires_at: args.expires_at,
    cumulative: args.cumulative,
    description: `Auto-created by Vortex coupon-rotation for product ${args.product_id}`,
  });

  let rule: VndaRule | undefined;
  let coupon: VndaCoupon | undefined;
  try {
    rule = await createVndaProductRule(config, promo.id, {
      product_id: args.product_id,
      amount: args.amount,
      discount_unit: args.discount_unit || "pct",
    });
    coupon = await createVndaCoupon(config, promo.id, {
      code: args.code,
      uses_per_code: args.uses_per_code,
      uses_per_user: args.uses_per_user,
    });
  } catch (err) {
    try {
      await pauseVndaPromotion(config, promo.id);
    } catch (cleanupErr) {
      console.error("[VNDA] cleanup pause after failure also failed:", cleanupErr);
    }
    throw err;
  }

  return {
    promotion_id: promo.id,
    rule_id: rule!.id,
    coupon_id: coupon!.id,
    coupon_code: coupon!.code,
    starts_at: args.starts_at,
    expires_at: args.expires_at,
  };
}

export { VndaError };
export type { VndaErrorPayload };
