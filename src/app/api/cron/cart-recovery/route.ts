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
  customer_state: string | null;
  customer_region: string | null;
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

interface ExistingMessageRow {
  id: string;
  cart_id: string;
  step_id: string;
  channel: "whatsapp" | "email";
  status: string;
  error: string | null;
  external_id: string | null;
  sent_at: string;
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
           email_enabled, email_subject, email_body_html,
           coupon_pct, coupon_validity_hours
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
          "id, workspace_id, customer_email, customer_phone, customer_name, customer_state, customer_region, cart_total, items, recovery_url, coupon_code, abandoned_at, recovery_started_at, vnda_client_id, enrichment_attempted_at, recovery_coupon_expires_at"
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
        .select("id, cart_id, step_id, channel, status, error, external_id, sent_at")
        .eq("workspace_id", workspaceId)
        .in("cart_id", activeCarts.map((c) => c.id));
      const existingRows = ((existingMessages || []) as ExistingMessageRow[]);
      const cartById = new Map(activeCarts.map((c) => [c.id, c]));
      const stepById = new Map(steps.map((s) => [s.id, s]));
      const staleReservationCutoff = new Date(
        now.getTime() - 30 * 60 * 1000
      );
      const staleReservationIds = existingRows
        .filter(
          (m) =>
            m.status === "sending" &&
            !m.external_id &&
            new Date(m.sent_at) < staleReservationCutoff
        )
        .map((m) => m.id);

      const retryableMessageIds = existingRows
        .filter((m) =>
          shouldResetExistingMessage(
            m,
            cartById.get(m.cart_id),
            stepById.get(m.step_id)
          )
        )
        .map((m) => m.id);

      const resetMessageIds = Array.from(
        new Set([...staleReservationIds, ...retryableMessageIds])
      );
      if (resetMessageIds.length > 0) {
        await admin
          .from("cart_recovery_messages")
          .delete()
          .in("id", resetMessageIds);
      }
      const resetMessageSet = new Set(resetMessageIds);
      const messageByKey = new Map(
        existingRows
          .filter((m) => !resetMessageSet.has(m.id))
          .map((m) => [`${m.cart_id}:${m.step_id}:${m.channel}`, m])
      );
      const sent = new Set(messageByKey.keys());

      // 5. Para cada cart × step, dispara o que ainda falta.
      for (const cart of activeCarts) {
        // Delays calculados desde recovery_started_at (import retroativo)
        // ou abandoned_at (webhook normal). Sem isso, carts importados de
        // 3 dias atrás disparariam Step 1+2+3 simultaneamente.
        const abandonedAt = cartStartTime(cart).getTime();

        // Enrichment best-effort: se faltar nome/telefone/UF, busca via
        // VNDA/CRM antes do dispatch. Marca attempted_at pra não retentar em
        // runs futuros. Não bloqueia o dispatch — se falhar, segue sem campo.
        let enrichedName = cart.customer_name;
        let enrichedPhone = cart.customer_phone;
        let enrichedState = cart.customer_state;
        let enrichedRegion = cart.customer_region;
        if (
          !cart.enrichment_attempted_at &&
          (!cart.customer_name || !cart.customer_phone || !cart.customer_state)
        ) {
          const result = await enrichCart(admin, workspaceId, cart);
          enrichedName = result.customer_name;
          enrichedPhone = result.customer_phone;
          enrichedState = result.customer_state;
          enrichedRegion = result.customer_region;
        }

        const cartForVars = {
          ...cart,
          customer_name: enrichedName,
          customer_phone: enrichedPhone,
          customer_state: enrichedState,
          customer_region: enrichedRegion,
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
            const reservation = await reserveMessageLog(admin, {
              workspaceId,
              cartId: cart.id,
              stepId: step.id,
              channel: "whatsapp",
            });
            if (!reservation.reserved) {
              sent.add(`${cart.id}:${step.id}:whatsapp`);
              continue;
            }

            const result = await dispatchWhatsApp({
              admin,
              workspaceId,
              cart: { ...cartForVars, items: cartForVars.items as never },
              step,
            });

            // template_pending = Meta ainda revisando — NÃO logamos pra
            // poder retentar quando aprovar. Qualquer outro erro vira row.
            if (result.error === "template_pending") {
              await deleteMessageLogReservation(admin, reservation.id);
              continue;
            }

            await finalizeMessageLog(admin, reservation.id, {
              ok: result.ok,
              externalId: result.externalId,
              error: result.error,
              renderedPayload: result.renderedPayload,
            });
            sent.add(`${cart.id}:${step.id}:whatsapp`);
            if (result.ok) totalDispatched++;
          } else if (step.whatsapp_enabled && cartForVars.customer_phone) {
            const key = `${cart.id}:${step.id}:whatsapp`;
            const existing = messageByKey.get(key);
            if (existing?.status === "skipped" && existing.error === "no_phone") {
              await deleteMessageLogReservation(admin, existing.id);
              sent.delete(key);
              messageByKey.delete(key);

              const reservation = await reserveMessageLog(admin, {
                workspaceId,
                cartId: cart.id,
                stepId: step.id,
                channel: "whatsapp",
              });
              if (!reservation.reserved) {
                sent.add(key);
                continue;
              }

              const result = await dispatchWhatsApp({
                admin,
                workspaceId,
                cart: { ...cartForVars, items: cartForVars.items as never },
                step,
              });

              if (result.error === "template_pending") {
                await deleteMessageLogReservation(admin, reservation.id);
                continue;
              }

              await finalizeMessageLog(admin, reservation.id, {
                ok: result.ok,
                externalId: result.externalId,
                error: result.error,
                renderedPayload: result.renderedPayload,
              });
              sent.add(key);
              if (result.ok) totalDispatched++;
            }
          }

          // Email.
          if (
            step.email_enabled &&
            !sent.has(`${cart.id}:${step.id}:email`)
          ) {
            const reservation = await reserveMessageLog(admin, {
              workspaceId,
              cartId: cart.id,
              stepId: step.id,
              channel: "email",
            });
            if (!reservation.reserved) {
              sent.add(`${cart.id}:${step.id}:email`);
              continue;
            }

            const result = await dispatchEmail({
              admin,
              workspaceId,
              cart: { ...cartForVars, items: cartForVars.items as never },
              step,
            });
            await finalizeMessageLog(admin, reservation.id, {
              ok: result.ok,
              externalId: result.externalId,
              error: result.error,
              renderedPayload: result.renderedPayload,
            });
            sent.add(`${cart.id}:${step.id}:email`);
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

function shouldResetExistingMessage(
  message: ExistingMessageRow,
  cart: CartRow | undefined,
  step: CartRecoveryStep | undefined
) {
  if (message.channel === "whatsapp" && step?.whatsapp_enabled) {
    if (
      message.status === "skipped" &&
      message.error === "no_phone" &&
      Boolean(cart?.customer_phone)
    ) {
      return true;
    }

    if (
      message.status === "failed" &&
      message.error?.startsWith("stale_cart_recovery_queue_expired")
    ) {
      return true;
    }

    if (
      message.status === "failed" &&
      message.error === "no_template" &&
      Boolean(step?.whatsapp_template_id)
    ) {
      return true;
    }
  }

  if (message.channel === "email" && step?.email_enabled) {
    if (message.status === "failed" && isTransientEmailError(message.error)) {
      return true;
    }

    if (
      message.status === "skipped" &&
      message.error === "missing_email_content" &&
      Boolean(step?.email_subject && step.email_body_html)
    ) {
      return true;
    }
  }

  return false;
}

function isTransientEmailError(error: string | null | undefined) {
  const value = String(error || "").toLowerCase();
  return (
    value === "fetch failed" ||
    value === "network_error" ||
    value.includes("timeout") ||
    value.includes("econnreset") ||
    value.includes("etimedout") ||
    value.startsWith("http 429") ||
    /^http 5\d\d/.test(value)
  );
}

async function reserveMessageLog(
  admin: ReturnType<typeof createAdminClient>,
  params: {
    workspaceId: string;
    cartId: string;
    stepId: string;
    channel: "whatsapp" | "email";
  }
) {
  // Reserva antes do dispatch: o índice UNIQUE vira a trava contra dois
  // crons criando campanhas/mensagens para o mesmo cart+step+canal.
  const { data, error } = await admin
    .from("cart_recovery_messages")
    .insert({
      workspace_id: params.workspaceId,
      cart_id: params.cartId,
      step_id: params.stepId,
      channel: params.channel,
      status: "sending",
    })
    .select("id")
    .single();

  if (error?.code === "23505") {
    return { reserved: false, id: "" };
  }
  if (error || !data?.id) {
    console.error(
      `[Cart Recovery] Failed to reserve message for cart ${params.cartId}:`,
      error?.message || "missing reservation id"
    );
    return { reserved: false, id: "" };
  }

  return { reserved: true, id: data.id as string };
}

async function deleteMessageLogReservation(
  admin: ReturnType<typeof createAdminClient>,
  id: string
) {
  await admin.from("cart_recovery_messages").delete().eq("id", id);
}

function finalMessageStatus(params: { ok: boolean; error?: string }) {
  if (params.ok) return "sent";
  return params.error === "no_phone" ||
    params.error === "no_smtp_config" ||
    params.error === "missing_email_content"
    ? "skipped"
    : "failed";
}

async function finalizeMessageLog(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  params: {
    ok: boolean;
    externalId?: string;
    error?: string;
    renderedPayload?: Record<string, unknown>;
  }
) {
  const { error } = await admin
    .from("cart_recovery_messages")
    .update({
      status: finalMessageStatus(params),
      external_id: params.externalId || null,
      error: params.error || null,
      rendered_payload: params.renderedPayload || null,
    })
    .eq("id", id);

  if (error) {
    console.error(
      `[Cart Recovery] Failed to finalize message log ${id}:`,
      error.message
    );
  }
}
