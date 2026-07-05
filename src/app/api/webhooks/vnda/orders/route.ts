import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  mapVndaPayloadToCrmRow,
  validateWebhookPayload,
} from "@/lib/vnda-webhook";
import {
  createCashbackFromOrder,
  markAsUsedFromOrder,
  cancelCashback,
  extractCreditUsed,
} from "@/lib/cashback/api";
import { dispatchVndaPurchaseToCapi } from "@/lib/meta-capi-vnda";
import { syncCustomerToAutoSegmentLists } from "@/lib/segments/sync";
import { normalizeBrazilianWhatsAppPhone } from "@/lib/phone";

export const maxDuration = 30;

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json(
      { error: "Missing token parameter" },
      { status: 401 }
    );
  }

  const admin = createAdminClient();

  // Look up workspace by webhook token (with 5s timeout)
  const connectionResult = await withTimeout(
    Promise.resolve(
      admin
        .from("vnda_connections")
        .select("workspace_id, enable_cashback, store_host")
        .eq("webhook_token", token)
        .limit(1)
        .single()
    ),
    5000
  );

  if (!connectionResult) {
    console.warn("[VNDA Webhook] DB timeout on token lookup");
    return NextResponse.json({ error: "DB timeout" }, { status: 503 });
  }

  const { data: connection, error: connError } = connectionResult;

  if (connError || !connection?.workspace_id) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const workspaceId = connection.workspace_id as string;
  const enableCashback = Boolean(
    (connection as { enable_cashback?: boolean }).enable_cashback
  );
  const storeHost =
    (connection as { store_host?: string | null }).store_host ?? null;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    await logWebhook(admin, workspaceId, null, "error", null, "Invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!validateWebhookPayload(payload)) {
    console.warn(`[VNDA Webhook] Validation failed for workspace ${workspaceId}: missing id, email, or total`);
    await logWebhook(admin, workspaceId, null, "error", payload, "Payload validation failed: missing id, email, or total");
    // Return 200 to avoid VNDA retries on bad payloads
    return NextResponse.json({ ok: false, reason: "validation_failed" });
  }

  const orderId = String(payload.id);

  try {
    const row = mapVndaPayloadToCrmRow(payload, workspaceId);

    // Upsert: if same order arrives again, update instead of duplicate (with 8s timeout)
    const upsertResult = await withTimeout(
      Promise.resolve(
        admin
          .from("crm_vendas")
          .upsert(row, {
            onConflict: "workspace_id, source, source_order_id",
            ignoreDuplicates: false,
          })
      ),
      8000
    );

    if (!upsertResult) {
      console.warn(`[VNDA Webhook] DB timeout on upsert for order ${orderId}`);
      await logWebhook(admin, workspaceId, orderId, "error", null, "upsert timeout after 8s");
      return NextResponse.json({ ok: false, reason: "db_timeout" });
    }

    const { error: upsertError } = upsertResult;
    if (upsertError) {
      // Check if it's a unique constraint violation (duplicate)
      if (upsertError.code === "23505") {
        console.log(`[VNDA Webhook] Duplicate order ${orderId} for workspace ${workspaceId}`);
        await logWebhook(admin, workspaceId, orderId, "duplicate", null, null);
        return NextResponse.json({ ok: true, status: "duplicate" });
      }
      throw upsertError;
    }

    console.log(`[VNDA Webhook] Order ${orderId} created for workspace ${workspaceId}`);
    await logWebhook(admin, workspaceId, orderId, "success", null, null);

    // Auto-segment lists update (gender, state, etc.).
    // Isolado: qualquer falha aqui é só log, nunca quebra o webhook.
    // Reutiliza phone normalization que cart-recovery faz logo abaixo.
    try {
      const fullName = [payload.first_name, payload.last_name]
        .filter((s) => typeof s === "string" && s.trim().length > 0)
        .join(" ");
      const rawPhone =
        (payload.cellphone &&
          `${payload.cellphone_area || ""}${payload.cellphone}`) ||
        (payload.phone &&
          `${payload.phone_area || ""}${payload.phone}`) ||
        payload.shipping_address?.phone ||
        "";
      const phone = normalizeBrazilianWhatsAppPhone(rawPhone) || "";
      const state = payload.shipping_address?.state || payload.state || null;
      const syncResults = await syncCustomerToAutoSegmentLists(admin, workspaceId, {
        name: fullName || null,
        email: payload.email || null,
        phone: phone || null,
        state,
      });
      const appendedCount = syncResults.filter((r) => r.appended).length;
      if (appendedCount > 0) {
        console.log(
          `[VNDA Webhook] Order ${orderId} appended to ${appendedCount} auto-segment list(s)`
        );
      }
    } catch (segErr) {
      console.error(
        `[VNDA Webhook] Auto-segment sync failed for order ${orderId}:`,
        segErr instanceof Error ? segErr.message : segErr
      );
    }

    // Keep the last good CRM snapshot available. The scheduled/manual
    // recompute will refresh it; deleting here can make the dashboard render
    // as an empty CRM if Supabase has a transient timeout during recompute.

    // Cart recovery: fechar carts abertos do mesmo cliente — cliente
    // comprou, régua tem que parar. Match por email OU telefone
    // (cliente pode ter abandonado com email errado e refeito com email
    // certo mas mesmo telefone). Isolado pra que qualquer erro aqui não
    // derrube o webhook.
    try {
      const email = (payload.email || "").toLowerCase().trim();
      const rawPhone =
        (payload.cellphone &&
          `${payload.cellphone_area || ""}${payload.cellphone}`) ||
        (payload.phone &&
          `${payload.phone_area || ""}${payload.phone}`) ||
        payload.shipping_address?.phone ||
        "";
      const rawPhoneDigits = rawPhone ? String(rawPhone).replace(/\D/g, "") : "";
      const phone = normalizeBrazilianWhatsAppPhone(rawPhone) || "";

      const orParts: string[] = [];
      if (email) orParts.push(`customer_email.eq.${email}`);
      if (phone) orParts.push(`customer_phone.eq.${phone}`);
      if (rawPhoneDigits && rawPhoneDigits !== phone) {
        orParts.push(`customer_phone.eq.${rawPhoneDigits}`);
      }

      if (orParts.length > 0) {
        const { data: closed, error: closeErr } = await admin
          .from("abandoned_carts")
          .update({
            status: "recovered",
            recovered_at: new Date().toISOString(),
          })
          .eq("workspace_id", workspaceId)
          .eq("status", "open")
          .or(orParts.join(","))
          .select("id, customer_email, customer_phone");

        if (closeErr) {
          console.error(
            `[VNDA Webhook] Cart recovery close error for order ${orderId}:`,
            closeErr.message
          );
        } else if (closed && closed.length > 0) {
          console.log(
            `[VNDA Webhook] Closed ${closed.length} cart(s) for order ${orderId} (match: email=${email || "—"}, phone=${phone || "—"})`
          );
        }
      }
    } catch (cartErr) {
      console.error(
        `[VNDA Webhook] Cart recovery close failed for order ${orderId}:`,
        cartErr instanceof Error ? cartErr.message : cartErr
      );
    }

    // Meta CAPI Purchase — isolated so a Meta outage never breaks the webhook.
    // Gated by META_CAPI_VNDA_WORKSPACE_ID so only the BK COM workspace
    // forwards to the configured CAPI pixel. Uses deterministic event_id so
    // it deduplicates with the browser-side purchase event.
    try {
      const capiRes = await dispatchVndaPurchaseToCapi({
        workspaceId,
        storeHost,
        payload,
      });
      if (capiRes.ok) {
        console.log(
          `[VNDA Webhook] CAPI Purchase forwarded for order ${orderId} (fbtrace=${capiRes.fbtrace_id || "n/a"})`
        );
      } else if (capiRes.reason && capiRes.reason !== "workspace_not_allowed" && capiRes.reason !== "not_configured") {
        console.warn(
          `[VNDA Webhook] CAPI Purchase skipped/failed for ${orderId}: ${capiRes.reason}`
        );
      }
    } catch (capiErr) {
      console.error(
        `[VNDA Webhook] CAPI dispatch threw for order ${orderId}:`,
        capiErr instanceof Error ? capiErr.message : capiErr
      );
    }

    // Cashback dispatch — isolated so any failure never breaks the webhook.
    if (enableCashback) {
      try {
        const status = (payload.status || "").toLowerCase();
        const creditUsed = extractCreditUsed(payload);

        if (status === "cancelled" || status === "canceled") {
          await cancelCashback(workspaceId, orderId, admin);
        } else if (creditUsed > 0) {
          await markAsUsedFromOrder(workspaceId, payload, { admin });
        } else {
          const cashbackResult = await createCashbackFromOrder(workspaceId, payload, { admin });
          if (
            !cashbackResult.created &&
            cashbackResult.reason &&
            cashbackResult.reason !== "duplicate"
          ) {
            await logWebhook(
              admin,
              workspaceId,
              orderId,
              "cashback_skipped",
              null,
              cashbackResult.reason
            );
          }
        }
      } catch (cashbackErr) {
        console.error(
          `[VNDA Webhook] Cashback dispatch failed for order ${orderId}:`,
          cashbackErr instanceof Error ? cashbackErr.message : cashbackErr
        );
      }
    }

    // Chat Commerce v2: anexa a RECEITA REAL (ground-truth, bússola MER) à
    // atribuição criada pelo order_placed do /chat. Keyed pelo code do pedido
    // (o mesmo que o shelves.js extrai de /pedido/<code>). Isolado: nunca quebra
    // o webhook. Só confirma receita de sessões que o cliente já atribuiu; se a
    // coluna/tabela não existir (migration-133 pendente), ignora.
    try {
      const p = payload as unknown as Record<string, unknown>;
      const orderCode = String((p.code as string) || orderId);
      const num = (v: unknown): number | null => {
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const rawItems = Array.isArray(p.items) ? (p.items as Array<Record<string, unknown>>) : [];
      const orderItems = rawItems.slice(0, 60).map((it) => ({
        sku: String(it.sku || ""),
        qty: num(it.quantity) ?? 1,
        total: num(it.total) ?? num(it.price) ?? 0,
      }));
      // UPSERT (não UPDATE): se o webhook chega ANTES da confirmação client-side,
      // cria a linha só com a receita (atk fica NULL até o beacon do /chat
      // preencher). Se a linha já existe, anexa a receita sem tocar no atk. Assim
      // a ordem de chegada webhook/cliente não perde a receita (bússola MER).
      await admin
        .from("assistant_attributions")
        .upsert(
          {
            workspace_id: workspaceId,
            order_code: orderCode,
            order_total: num(p.total),
            order_subtotal: num(p.subtotal),
            order_discount: num(p.discount) ?? num(p.discount_price),
            order_items: orderItems,
            revenue_confirmed: true,
            confirmed_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id,order_code" }
        );
      console.log(`[VNDA Webhook] Chat attribution revenue upserted for order ${orderCode}`);
    } catch (attrErr) {
      console.error(
        `[VNDA Webhook] Chat attribution update failed for order ${orderId}:`,
        attrErr instanceof Error ? attrErr.message : attrErr
      );
    }

    return NextResponse.json({ ok: true, status: "created" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const details = err && typeof err === "object" ? JSON.stringify(err) : message;
    console.error(`[VNDA Webhook] Error processing order ${orderId} for workspace ${workspaceId}:`, message, err);
    await logWebhook(admin, workspaceId, orderId, "error", payload, details);
    // Return 200 to prevent aggressive retries from VNDA
    return NextResponse.json({ ok: false, reason: "processing_error", error: message });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function logWebhook(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  orderId: string | null,
  status: string,
  payload: unknown,
  errorMessage: string | null
) {
  try {
    await admin.from("vnda_webhook_logs").insert({
      workspace_id: workspaceId,
      order_id: orderId,
      status,
      payload: payload ? JSON.parse(JSON.stringify(payload)) : null,
      error_message: errorMessage,
    });
  } catch (logErr) {
    console.error("[VNDA Webhook] Failed to write log:", logErr);
  }
}
