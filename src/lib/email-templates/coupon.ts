// src/lib/email-templates/coupon.ts
//
// Cupons do slot 2 (slowmoving): código + janela de validade gerados
// localmente; registro real na VNDA acontece só no dispatch (assim
// sugestões geradas mas nunca enviadas não enchem a VNDA de promoções
// inúteis).
//
// Fluxo:
//   1. prepareSlowmovingCoupon  → gera code/expires_at em memória. Sem VNDA.
//      Chamado pelo orchestrator no cron de geração.
//   2. registerSlowmovingCouponInVnda → cria a promoção+cupom na VNDA usando
//      um code/expires_at já preparados. Chamado pelo dispatch endpoint
//      antes do envio.
//
// `createSlowmovingCoupon` continua exportado por compat (chama os dois em
// sequência) — usado por testes/fluxos legados que ainda esperam o registro
// síncrono.

import { randomInt } from "crypto";
import {
  createFullCoupon,
  getVndaConfigForWorkspace,
} from "@/lib/coupons/vnda-coupons";
import type { SupabaseClient } from "@supabase/supabase-js";
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

export interface PreparedCoupon {
  code: string;
  expires_at: Date;
  discount_percent: number;
}

export interface CreatedCoupon extends PreparedCoupon {
  vnda_promotion_id: number;
  vnda_coupon_id: number;
}

/** Gera code + expires_at sem tocar na VNDA. Usado no momento da geração da
 *  sugestão — barato, idempotente. O registro real na VNDA é deferido pro
 *  dispatch. */
export function prepareSlowmovingCoupon(args: {
  discount_percent: number;
  validity_hours: number;
}): PreparedCoupon {
  return {
    code: `EMAIL-SLOWMOV-${randomBase32(5)}`,
    expires_at: new Date(Date.now() + args.validity_hours * 60 * 60 * 1000),
    discount_percent: args.discount_percent,
  };
}

/** Registra na VNDA o cupom já preparado. Usado no momento do dispatch.
 *  Retorna os ids da VNDA pra persistirmos na linha da sugestão. */
export async function registerSlowmovingCouponInVnda(args: {
  workspace_id: string;
  product: ProductSnapshot;
  prepared: PreparedCoupon;
}): Promise<CreatedCoupon> {
  const config = await getVndaConfigForWorkspace(args.workspace_id);
  if (!config) throw new Error("VNDA config missing for workspace");

  const result = await createFullCoupon(config, {
    name: `Email Templates · slot 2 · ${args.product.name}`,
    code: args.prepared.code,
    product_id: args.product.vnda_id,
    amount: args.prepared.discount_percent,
    discount_unit: "pct",
    starts_at: new Date(),
    expires_at: args.prepared.expires_at,
    cumulative: false,
    uses_per_code: 10_000,
    uses_per_user: 1,
  });

  // Same source-of-truth choice as antes: nosso code local é canônico — a
  // VNDA às vezes retorna coupon_code undefined apesar da tipagem.
  return {
    code: result.coupon_code ?? args.prepared.code,
    vnda_promotion_id: result.promotion_id,
    vnda_coupon_id: result.coupon_id,
    expires_at: result.expires_at ?? args.prepared.expires_at,
    discount_percent: args.prepared.discount_percent,
  };
}

/** Combined helper. Mantido pra compat — mas o caminho normal agora é
 *  prepare-no-cron + register-no-dispatch. */
export async function createSlowmovingCoupon(args: {
  workspace_id: string;
  product: ProductSnapshot;
  discount_percent: number;
  validity_hours: number;
}): Promise<CreatedCoupon> {
  const prepared = prepareSlowmovingCoupon({
    discount_percent: args.discount_percent,
    validity_hours: args.validity_hours,
  });
  return registerSlowmovingCouponInVnda({
    workspace_id: args.workspace_id,
    product: args.product,
    prepared,
  });
}

// ────────────────────────────────────────────────────────────────────────
// Lazy registration no dispatch
// ────────────────────────────────────────────────────────────────────────

export interface SuggestionCouponState {
  id: string;
  product_snapshot?: (Partial<ProductSnapshot> & { name?: string }) | null;
  coupon_code: string | null;
  coupon_vnda_promotion_id: number | null;
  coupon_vnda_coupon_id: number | null;
  coupon_expires_at: string | null;
  coupon_discount_percent: number | null;
}

export type EnsureCouponResult =
  | { ok: true }
  | { ok: false; error: string; statusCode: number };

/** Garante que o cupom da sugestão está registrado na VNDA antes do envio.
 *  - Sem cupom (slot ≠ 2): no-op.
 *  - Já registrado: no-op.
 *  - Preparado: chama VNDA agora, persiste os ids na linha da sugestão.
 *  - Expirado: rejeita, pedindo regerar (HTML embute o expires_at). */
export async function ensureCouponRegistered(
  sb: SupabaseClient,
  workspaceId: string,
  s: SuggestionCouponState
): Promise<EnsureCouponResult> {
  if (!s.coupon_code) return { ok: true };
  if (s.coupon_vnda_promotion_id) return { ok: true };

  if (!s.coupon_expires_at) {
    return {
      ok: false,
      error: "Cupom sem data de expiração — gere a sugestão novamente.",
      statusCode: 400,
    };
  }
  const expiresAt = new Date(s.coupon_expires_at);
  if (expiresAt.getTime() <= Date.now()) {
    return {
      ok: false,
      error: "O cupom desta sugestão venceu. Gere uma sugestão nova pra disparar.",
      statusCode: 400,
    };
  }
  const product = s.product_snapshot;
  if (!product || !product.name || !product.vnda_id) {
    return {
      ok: false,
      error: "Sugestão sem snapshot de produto — não dá pra registrar cupom.",
      statusCode: 400,
    };
  }

  try {
    const created = await registerSlowmovingCouponInVnda({
      workspace_id: workspaceId,
      product: product as ProductSnapshot,
      prepared: {
        code: s.coupon_code,
        expires_at: expiresAt,
        discount_percent: Number(s.coupon_discount_percent ?? 10),
      },
    });
    await sb
      .from("email_template_suggestions")
      .update({
        coupon_vnda_promotion_id: created.vnda_promotion_id,
        coupon_vnda_coupon_id: created.vnda_coupon_id,
      })
      .eq("id", s.id);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `Falha ao registrar cupom na VNDA: ${(err as Error).message}`,
      statusCode: 502,
    };
  }
}
