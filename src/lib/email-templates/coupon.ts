// src/lib/email-templates/coupon.ts
//
// Wraps createFullCoupon (from src/lib/coupons/vnda-coupons.ts) to mint a
// dedicated coupon for slot 2 (slowmoving). The coupon is product-scoped,
// percent-based, single-use per user, capped at a generous total redemption
// count for the email blast, and short-lived (validity_hours from settings).

import { randomInt } from "crypto";
import {
  createFullCoupon,
  getVndaConfigForWorkspace,
} from "@/lib/coupons/vnda-coupons";
import type { ProductSnapshot } from "./types";

// Omit ambiguous chars (0/O, 1/I/L) for human-readable codes
const BASE32_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomBase32(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += BASE32_ALPHABET[randomInt(0, BASE32_ALPHABET.length)];
  }
  return out;
}

export interface CreatedCoupon {
  code: string;
  vnda_promotion_id: number;
  vnda_coupon_id: number;
  expires_at: Date;
  discount_percent: number;
}

/**
 * Create a slowmoving-slot coupon: percent off, scoped to one product,
 * 1 use per user, total redemption capped at 10_000, valid for `validity_hours`.
 */
export async function createSlowmovingCoupon(args: {
  workspace_id: string;
  product: ProductSnapshot;
  discount_percent: number;
  validity_hours: number;
}): Promise<CreatedCoupon> {
  const config = await getVndaConfigForWorkspace(args.workspace_id);
  if (!config) throw new Error("VNDA config missing for workspace");

  const code = `EMAIL-SLOWMOV-${randomBase32(5)}`;
  const starts_at = new Date();
  const expires_at = new Date(Date.now() + args.validity_hours * 60 * 60 * 1000);

  const result = await createFullCoupon(config, {
    name: `Email Templates · slot 2 · ${args.product.name}`,
    code,
    product_id: args.product.vnda_id,
    amount: args.discount_percent,
    discount_unit: "pct",
    starts_at,
    expires_at,
    cumulative: false,
    uses_per_code: 10_000,
    uses_per_user: 1,
  });

  // Use our locally-generated `code` as the source of truth — VNDA's
  // result.coupon_code occasionally comes back undefined despite the typed
  // contract, which previously caused null coupon_code in the DB and broken
  // {coupon} placeholders in copy/render.
  return {
    code: result.coupon_code ?? code,
    vnda_promotion_id: result.promotion_id,
    vnda_coupon_id: result.coupon_id,
    expires_at: result.expires_at ?? expires_at,
    discount_percent: args.discount_percent,
  };
}
