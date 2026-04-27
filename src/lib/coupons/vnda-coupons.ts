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

export async function createVndaProductRule(
  config: VndaConfig,
  promotionId: number,
  args: { product_id: string | number; discount_pct: number }
): Promise<VndaRule> {
  const productIdNum = typeof args.product_id === "string" ? parseInt(args.product_id, 10) : args.product_id;
  if (!Number.isFinite(productIdNum)) {
    throw new Error(`Invalid product_id: ${args.product_id}`);
  }
  return vndaWrite<VndaRule>("POST", `discounts/${promotionId}/rules/`, config, {
    product_id: productIdNum,
    apply_to: "product",
    amount_type: "%",
    amount: args.discount_pct,
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
    discount_pct: number;
    starts_at: Date;
    expires_at: Date;
    cumulative: boolean;
    uses_per_code: number;
    uses_per_user: number;
  }
): Promise<CreateFullCouponResult> {
  // 1. Create the parent promotion
  const promo = await createVndaPromotion(config, {
    name: args.name,
    starts_at: args.starts_at,
    expires_at: args.expires_at,
    cumulative: args.cumulative,
    description: `Auto-created by Vortex coupon-rotation for product ${args.product_id}`,
  });

  // 2. Create the product rule + coupon. If either fails, pause the promotion
  //    so it never goes live with a half-configured state.
  let rule: VndaRule | undefined;
  let coupon: VndaCoupon | undefined;
  try {
    rule = await createVndaProductRule(config, promo.id, {
      product_id: args.product_id,
      discount_pct: args.discount_pct,
    });
    coupon = await createVndaCoupon(config, promo.id, {
      code: args.code,
      uses_per_code: args.uses_per_code,
      uses_per_user: args.uses_per_user,
    });
  } catch (err) {
    // Best-effort cleanup so we don't leave a dangling enabled promotion
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
