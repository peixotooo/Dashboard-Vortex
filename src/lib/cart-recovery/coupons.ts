// Gera cupom único de recuperação de carrinho na VNDA.
//
// Por que cupom POR CARRINHO (não compartilhado):
// - Evita que o código vire viral (compartilhado em fóruns/groups) e
//   detonar margem do workspace.
// - Permite controlar uses_per_code = 1 (Meta uso único) e attribution
//   exata (cupom X foi usado pelo cliente Y).
//
// Estratégia:
// 1. Cria promotion VNDA com valid_to: "cart"
// 2. Cria rule apply_to: "cart" com X% off
// 3. Cria coupon code único (BKNG_{cart_id_short})
// 4. Salva code + promotion_id + expires_at em abandoned_carts
//
// Idempotência: se cart já tem coupon_code, retorna o existente. Se a
// criação falhar, marca falha mas não bloqueia o dispatch — sem cupom
// a mensagem ainda vai, só sem a variável {{coupon_code}} preenchida.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createFullCoupon,
  createVndaCartRule,
  createVndaCoupon,
  createVndaPromotion,
  getVndaConfigForWorkspace,
} from "@/lib/coupons/vnda-coupons";

export interface RecoveryCouponResult {
  code: string;
  expiresAt: string;
  alreadyExisted?: boolean;
}

interface CartWithCoupon {
  id: string;
  coupon_code: string | null;
  recovery_coupon_expires_at: string | null;
}

function shortId(): string {
  // 6 chars alfanuméricos, evita 0/O/I/1 pra reduzir confusão.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export async function ensureRecoveryCoupon(
  admin: SupabaseClient,
  workspaceId: string,
  cart: CartWithCoupon,
  opts: { pct: number; validityHours: number }
): Promise<RecoveryCouponResult | null> {
  // Já existe e ainda válido → reusa.
  if (cart.coupon_code && cart.recovery_coupon_expires_at) {
    const expiresAt = new Date(cart.recovery_coupon_expires_at);
    if (expiresAt.getTime() > Date.now()) {
      return {
        code: cart.coupon_code,
        expiresAt: cart.recovery_coupon_expires_at,
        alreadyExisted: true,
      };
    }
  }

  const config = await getVndaConfigForWorkspace(workspaceId);
  if (!config) {
    console.warn(
      `[CartRecovery Coupon] No VNDA config for workspace ${workspaceId}`
    );
    return null;
  }

  const code = `BKNG${opts.pct}_${shortId()}`;
  const startsAt = new Date();
  const expiresAt = new Date(
    startsAt.getTime() + opts.validityHours * 3600 * 1000
  );

  try {
    // Cria promotion + cart rule + coupon code. Não usa createFullCoupon
    // porque aquele exige product_id (regra de produto). Aqui queremos
    // cart-wide.
    const promo = await createVndaPromotion(config, {
      name: `Cart Recovery — ${code}`,
      starts_at: startsAt,
      expires_at: expiresAt,
      cumulative: false,
      description: `Auto-gerado pra cart ${cart.id.slice(0, 8)}`,
    });

    try {
      await createVndaCartRule(config, promo.id, {
        amount: opts.pct,
        discount_unit: "pct",
      });
      await createVndaCoupon(config, promo.id, {
        code,
        uses_per_code: 1,
        uses_per_user: 1,
      });
    } catch (err) {
      // Não conseguimos limpar a promotion (sem endpoint DELETE
      // exposto), mas paused promo + 0 coupon code = não usável.
      console.error(
        `[CartRecovery Coupon] Failed mid-creation for cart ${cart.id}:`,
        err instanceof Error ? err.message : err
      );
      throw err;
    }

    // Persiste no cart pra reusar em retentativas e mostrar na UI.
    const expiresIso = expiresAt.toISOString();
    await admin
      .from("abandoned_carts")
      .update({
        coupon_code: code,
        recovery_coupon_promotion_id: promo.id,
        recovery_coupon_expires_at: expiresIso,
      })
      .eq("id", cart.id);

    console.log(
      `[CartRecovery Coupon] Created ${code} (${opts.pct}%, ${opts.validityHours}h) for cart ${cart.id}`
    );
    return { code, expiresAt: expiresIso };
  } catch (err) {
    console.error(
      `[CartRecovery Coupon] createFullCoupon error for cart ${cart.id}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// Silenciar warning de import não usado — mantemos a ref pra documentar
// que createFullCoupon (de produto) é a alternativa quando quiser cupom
// product-specific.
void createFullCoupon;
