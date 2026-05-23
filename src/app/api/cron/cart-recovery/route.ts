import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  dispatchEmail,
  dispatchWhatsApp,
} from "@/lib/cart-recovery/dispatch";
import { enrichCart } from "@/lib/cart-recovery/enrich";
import { ensureRecoveryCoupon } from "@/lib/cart-recovery/coupons";
import type { CartRecoveryStep } from "@/lib/cart-recovery/types";

export const maxDuration = 300;

// Cron de recuperação de carrinho.
// Para cada workspace com régua ativa:
//   1. Expira carts antigos (abandoned_at < now - expire_after_hours)
//   2. Para cada cart aberto × step:
//      - se delay venceu e canal ainda não foi disparado → dispara
//      - log em cart_recovery_messages (UNIQUE protege double-fire)

interface CartRow {
  id: string;
  workspace_id: string;
  customer_email: string;
  customer_phone: string | null;
  customer_name: string | null;
  cart_total: number | null;
  items: unknown;
  recovery_url: string | null;
  coupon_code: string | null;
  abandoned_at: string;
  recovery_started_at: string | null;
  vnda_client_id: number | null;
  enrichment_attempted_at: string | null;
  recovery_coupon_expires_at: string | null;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();

  try {
    // 1. Buscar todas as réguas ativas com seus steps.
    const { data: rules, error: rulesError } = await admin
      .from("cart_recovery_rules")
      .select(
        `id, workspace_id, expire_after_hours,
         steps:cart_recovery_steps(
           id, workspace_id, rule_id, step_order, delay_minutes,
           whatsapp_enabled, whatsapp_template_id, whatsapp_variable_mapping,
           email_enabled, email_subject, email_body_html
         )`
      )
      .eq("enabled", true);

    if (rulesError) {
      console.error("[Cart Recovery]", rulesError.message);
      return NextResponse.json({ error: rulesError.message }, { status: 500 });
    }
    if (!rules || rules.length === 0) {
      return NextResponse.json({ processed: 0, message: "No active rules" });
    }

    let totalDispatched = 0;
    let totalExpired = 0;

    for (const rule of rules) {
      const workspaceId = rule.workspace_id as string;
      const steps = ((rule as unknown as { steps: CartRecoveryStep[] }).steps || [])
        .slice()
        .sort((a, b) => a.step_order - b.step_order);

      if (steps.length === 0) continue;

      // 2. Carts abertos.
      const { data: carts } = await admin
        .from("abandoned_carts")
        .select(
          "id, workspace_id, customer_email, customer_phone, customer_name, cart_total, items, recovery_url, coupon_code, abandoned_at, recovery_started_at, vnda_client_id, enrichment_attempted_at, recovery_coupon_expires_at"
        )
        .eq("workspace_id", workspaceId)
        .eq("status", "open")
        .limit(500);

      if (!carts || carts.length === 0) continue;

      // 3. Expira carts antigos (uma única update batch).
      // Usa recovery_started_at (se presente, caso de import retroativo)
      // ou abandoned_at (caso normal de webhook).
      const expireMs = (rule.expire_after_hours as number) * 3600 * 1000;
      const expireThreshold = new Date(now.getTime() - expireMs);
      const cartStartTime = (c: CartRow) =>
        new Date(c.recovery_started_at || c.abandoned_at);
      const expiredIds = carts
        .filter((c) => cartStartTime(c) < expireThreshold)
        .map((c) => c.id);
      if (expiredIds.length > 0) {
        await admin
          .from("abandoned_carts")
          .update({ status: "expired", closed_at: now.toISOString() })
          .in("id", expiredIds);
        totalExpired += expiredIds.length;
      }

      const activeCarts = carts.filter(
        (c) => !expiredIds.includes(c.id)
      ) as CartRow[];

      if (activeCarts.length === 0) continue;

      // 4. Pré-carrega cart_recovery_messages do workspace pra evitar
      //    N queries no loop. Indexa por `${cart_id}:${step_id}:${channel}`.
      const { data: existingMessages } = await admin
        .from("cart_recovery_messages")
        .select("cart_id, step_id, channel")
        .eq("workspace_id", workspaceId)
        .in("cart_id", activeCarts.map((c) => c.id));
      const sent = new Set(
        (existingMessages || []).map(
          (m) => `${m.cart_id}:${m.step_id}:${m.channel}`
        )
      );

      // 5. Para cada cart × step, dispara o que ainda falta.
      for (const cart of activeCarts) {
        // Delays calculados desde recovery_started_at (import retroativo)
        // ou abandoned_at (webhook normal). Sem isso, carts importados de
        // 3 dias atrás disparariam Step 1+2+3 simultaneamente.
        const abandonedAt = cartStartTime(cart).getTime();

        // Enrichment best-effort: se faltar nome/telefone e tiver client_id,
        // busca via VNDA antes do dispatch. Marca attempted_at pra não
        // retentar em runs futuros. Não bloqueia o dispatch — se falhar,
        // segue com customer_name = null.
        let enrichedName = cart.customer_name;
        let enrichedPhone = cart.customer_phone;
        if (
          !cart.enrichment_attempted_at &&
          cart.vnda_client_id &&
          (!cart.customer_name || !cart.customer_phone)
        ) {
          const result = await enrichCart(admin, workspaceId, cart);
          enrichedName = result.customer_name;
          enrichedPhone = result.customer_phone;
        }

        const cartForVars = {
          ...cart,
          customer_name: enrichedName,
          customer_phone: enrichedPhone,
          items: Array.isArray(cart.items) ? cart.items : [],
        };

        for (const step of steps) {
          const fireAt = abandonedAt + step.delay_minutes * 60 * 1000;
          if (fireAt > now.getTime()) continue;

          // Geração de cupom (se o step config requer e cart ainda não tem
          // cupom de recuperação ativo). Best-effort — falha aqui não
          // bloqueia o dispatch, apenas a variável {{coupon_code}} fica
          // vazia na mensagem.
          if ((step.coupon_pct || 0) > 0) {
            const couponResult = await ensureRecoveryCoupon(
              admin,
              workspaceId,
              {
                id: cart.id,
                coupon_code: cartForVars.coupon_code,
                recovery_coupon_expires_at: cart.recovery_coupon_expires_at,
              },
              {
                pct: step.coupon_pct,
                validityHours: step.coupon_validity_hours || 48,
              }
            );
            if (couponResult) {
              cartForVars.coupon_code = couponResult.code;
              cartForVars.recovery_coupon_expires_at = couponResult.expiresAt;
            }
          }

          // WhatsApp.
          if (
            step.whatsapp_enabled &&
            !sent.has(`${cart.id}:${step.id}:whatsapp`)
          ) {
            const result = await dispatchWhatsApp({
              admin,
              workspaceId,
              cart: { ...cartForVars, items: cartForVars.items as never },
              step,
            });
            // template_pending = Meta ainda revisando — NÃO logamos pra
            // poder retentar quando aprovar. Qualquer outro erro vira row.
            if (result.error !== "template_pending") {
              await insertMessageLog(admin, {
                workspaceId,
                cartId: cart.id,
                stepId: step.id,
                channel: "whatsapp",
                ok: result.ok,
                externalId: result.externalId,
                error: result.error,
              });
            }
            if (result.ok) totalDispatched++;
          }

          // Email.
          if (
            step.email_enabled &&
            !sent.has(`${cart.id}:${step.id}:email`)
          ) {
            const result = await dispatchEmail({
              admin,
              workspaceId,
              cart: { ...cartForVars, items: cartForVars.items as never },
              step,
            });
            await insertMessageLog(admin, {
              workspaceId,
              cartId: cart.id,
              stepId: step.id,
              channel: "email",
              ok: result.ok,
              externalId: result.externalId,
              error: result.error,
            });
            if (result.ok) totalDispatched++;
          }
        }
      }
    }

    return NextResponse.json({
      dispatched: totalDispatched,
      expired: totalExpired,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Cart Recovery]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function insertMessageLog(
  admin: ReturnType<typeof createAdminClient>,
  params: {
    workspaceId: string;
    cartId: string;
    stepId: string;
    channel: "whatsapp" | "email";
    ok: boolean;
    externalId?: string;
    error?: string;
  }
) {
  // Insere com tolerância a corrida — UNIQUE (cart_id, step_id, channel)
  // protege double-fire entre runs sobrepostos do cron.
  const { error } = await admin.from("cart_recovery_messages").insert({
    workspace_id: params.workspaceId,
    cart_id: params.cartId,
    step_id: params.stepId,
    channel: params.channel,
    status: params.ok ? "sent" : params.error === "no_phone" ||
      params.error === "no_smtp_config" ||
      params.error === "missing_email_content"
        ? "skipped"
        : "failed",
    external_id: params.externalId || null,
    error: params.error || null,
  });
  if (error && error.code !== "23505") {
    console.error(
      `[Cart Recovery] Failed to log message for cart ${params.cartId}:`,
      error.message
    );
  }
}
