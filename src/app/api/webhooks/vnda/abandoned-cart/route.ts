import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  normalizeCart,
  validateAbandonedCartPayload,
} from "@/lib/cart-recovery/payload";

export const maxDuration = 30;

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

// Mesmo padrão do webhook de orders: token via query, workspace via
// vnda_connections.webhook_token, resposta 200 imediata em erros pra
// evitar retries agressivos da VNDA.
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json(
      { error: "Missing token parameter" },
      { status: 401 }
    );
  }

  const admin = createAdminClient();

  const connectionResult = await withTimeout(
    Promise.resolve(
      admin
        .from("vnda_connections")
        .select("workspace_id, store_host")
        .eq("webhook_token", token)
        .limit(1)
        .single()
    ),
    5000
  );

  if (!connectionResult) {
    console.warn("[VNDA Abandoned] DB timeout on token lookup");
    return NextResponse.json({ error: "DB timeout" }, { status: 503 });
  }

  const { data: connection, error: connError } = connectionResult;
  if (connError || !connection?.workspace_id) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const workspaceId = connection.workspace_id as string;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    await logWebhook(admin, workspaceId, null, "error", null, "Invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!validateAbandonedCartPayload(payload)) {
    console.warn(
      `[VNDA Abandoned] Validation failed for workspace ${workspaceId}: missing email/identifier/items`
    );
    await logWebhook(
      admin,
      workspaceId,
      null,
      "error",
      payload,
      "Payload validation failed"
    );
    return NextResponse.json({ ok: false, reason: "validation_failed" });
  }

  const normalized = normalizeCart(payload);

  // Sem identificador único → não conseguimos deduplicar; gravamos mesmo
  // assim mas avisamos no log. Em prática a VNDA sempre manda token.
  if (!normalized.vnda_cart_token) {
    console.warn(
      `[VNDA Abandoned] No cart token for workspace ${workspaceId}, dedup disabled`
    );
  }

  const cartId = normalized.vnda_cart_token || normalized.vnda_cart_id || "unknown";

  try {
    // Upsert por (workspace_id, vnda_cart_token). Se o mesmo carrinho
    // chegar de novo (cliente adicionou item), atualizamos items/total
    // mas não resetamos a régua — abandoned_at fica o do primeiro evento.
    const upsertResult = await withTimeout(
      Promise.resolve(
        normalized.vnda_cart_token
          ? admin
              .from("abandoned_carts")
              .upsert(
                {
                  workspace_id: workspaceId,
                  vnda_cart_token: normalized.vnda_cart_token,
                  vnda_cart_id: normalized.vnda_cart_id,
                  vnda_client_id: normalized.vnda_client_id,
                  customer_email: normalized.customer_email,
                  customer_phone: normalized.customer_phone,
                  customer_name: normalized.customer_name,
                  customer_state: normalized.customer_state,
                  customer_region: normalized.customer_region,
                  items: normalized.items,
                  cart_total: normalized.cart_total,
                  recovery_url: normalized.recovery_url,
                  coupon_code: normalized.coupon_code,
                  abandoned_at: normalized.abandoned_at,
                  raw_payload: JSON.parse(JSON.stringify(payload)),
                  updated_at: new Date().toISOString(),
                },
                {
                  onConflict: "workspace_id,vnda_cart_token",
                  ignoreDuplicates: false,
                }
              )
          : admin.from("abandoned_carts").insert({
              workspace_id: workspaceId,
              vnda_cart_id: normalized.vnda_cart_id,
              vnda_client_id: normalized.vnda_client_id,
              customer_email: normalized.customer_email,
              customer_phone: normalized.customer_phone,
              customer_name: normalized.customer_name,
              customer_state: normalized.customer_state,
              customer_region: normalized.customer_region,
              items: normalized.items,
              cart_total: normalized.cart_total,
              recovery_url: normalized.recovery_url,
              coupon_code: normalized.coupon_code,
              abandoned_at: normalized.abandoned_at,
              raw_payload: JSON.parse(JSON.stringify(payload)),
            })
      ),
      8000
    );

    if (!upsertResult) {
      console.warn(`[VNDA Abandoned] DB timeout on upsert for cart ${cartId}`);
      await logWebhook(admin, workspaceId, cartId, "error", null, "upsert timeout");
      return NextResponse.json({ ok: false, reason: "db_timeout" });
    }

    const { error: upsertError } = upsertResult;
    if (upsertError) throw upsertError;

    console.log(
      `[VNDA Abandoned] Cart ${cartId} saved for workspace ${workspaceId}`
    );
    await logWebhook(admin, workspaceId, cartId, "success", null, null);

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Erros do Supabase são objetos {code, message, details, hint} — não
    // instâncias de Error. Capturamos tudo serializando.
    const detail = formatError(err);
    console.error(
      `[VNDA Abandoned] Error processing cart ${cartId} for workspace ${workspaceId}:`,
      detail
    );
    await logWebhook(admin, workspaceId, cartId, "error", payload, detail);
    return NextResponse.json({ ok: false, reason: "processing_error", error: detail });
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (e.code) parts.push(`code=${e.code}`);
    if (e.message) parts.push(String(e.message));
    if (e.details) parts.push(`details=${e.details}`);
    if (e.hint) parts.push(`hint=${e.hint}`);
    if (parts.length === 0) {
      try {
        return JSON.stringify(err).slice(0, 500);
      } catch {
        return "Unserializable error";
      }
    }
    return parts.join(" | ");
  }
  return String(err);
}

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
      order_id: orderId ? `cart:${orderId}` : null,
      status,
      payload: payload ? JSON.parse(JSON.stringify(payload)) : null,
      error_message: errorMessage,
    });
  } catch (logErr) {
    console.error("[VNDA Abandoned] Failed to write log:", logErr);
  }
}
