import type { SupabaseClient } from "@supabase/supabase-js";

export interface AssistantOrderItem {
  sku: string;
  reference?: string | null;
  qty: number;
  total: number;
}

interface SessionLinkInput {
  workspaceId: string;
  atk: string;
  orderToken?: string | null;
  orderCode?: string | null;
  orderId?: string | null;
  surface: "global" | "pdp" | "unknown";
  isTest: boolean;
  placedAt?: string | null;
}

interface WebhookOrderInput {
  workspaceId: string;
  orderToken?: string | null;
  orderCode?: string | null;
  orderId?: string | null;
  status?: string | null;
  total?: number | null;
  subtotal?: number | null;
  discount?: number | null;
  shipping?: number | null;
  items: AssistantOrderItem[];
  confirmedAt?: string | null;
}

function cleanToken(value: string | null | undefined, max = 128): string | null {
  const token = String(value || "").trim();
  return token && token.length <= max && /^[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

export function isCancelledAssistantOrder(status: string | null | undefined): boolean {
  return /cancel|refund|refunded|void|estorn/i.test(String(status || ""));
}

export function isConfirmedAssistantOrder(
  status: string | null | undefined,
  confirmedAt: string | null | undefined
): boolean {
  if (isCancelledAssistantOrder(status)) return false;
  if (confirmedAt && Number.isFinite(Date.parse(confirmedAt))) return true;
  return /confirm|paid|approved|authorized|shipped|delivered|invoiced|faturad/i.test(
    String(status || "")
  );
}

interface AttributionLookupRow {
  id: number;
  atk: string | null;
  surface: "global" | "pdp" | "unknown" | null;
  isTest: boolean;
  placedAt: string | null;
  source: string | null;
}

async function findAttributionBy(
  admin: SupabaseClient,
  workspaceId: string,
  column: "order_token" | "order_code" | "order_id",
  value: string | null
): Promise<AttributionLookupRow | null> {
  if (!value) return null;
  const { data, error } = await admin
    .from("assistant_attributions")
    .select("id, atk, surface, is_test, placed_at, source")
    .eq("workspace_id", workspaceId)
    .eq(column, value)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: Number(data.id),
    atk: data.atk ? String(data.atk) : null,
    surface:
      data.surface === "global" || data.surface === "pdp" || data.surface === "unknown"
        ? data.surface
        : null,
    isTest: data.is_test === true,
    placedAt: data.placed_at ? String(data.placed_at) : null,
    source: data.source ? String(data.source) : null,
  };
}

/** Liga a sessão ao token que aparece em /pedido/<token>. Não aceita valores. */
export async function linkAssistantSessionToOrder(
  admin: SupabaseClient,
  input: SessionLinkInput
): Promise<void> {
  const orderToken = cleanToken(input.orderToken);
  const orderCode = cleanToken(input.orderCode, 64);
  const orderId = cleanToken(input.orderId, 64);
  const atk = cleanToken(input.atk);
  if ((!orderToken && !orderCode && !orderId) || !atk) {
    throw new Error("invalid assistant attribution link");
  }

  const patch: Record<string, unknown> = {
    atk,
    surface: input.surface,
    is_test: input.isTest,
    placed_at: input.placedAt || new Date().toISOString(),
    source: "client_confirmation",
    confidence: 1,
  };
  if (orderToken) patch.order_token = orderToken;
  if (orderCode) patch.order_code = orderCode;
  if (orderId) patch.order_id = orderId;
  const existing =
    (await findAttributionBy(admin, input.workspaceId, "order_token", orderToken)) ||
    (await findAttributionBy(admin, input.workspaceId, "order_code", orderCode)) ||
    (await findAttributionBy(admin, input.workspaceId, "order_id", orderId));
  if (existing) {
    const { error } = await admin
      .from("assistant_attributions")
      .update(patch)
      .eq("id", existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await admin.from("assistant_attributions").insert({
    workspace_id: input.workspaceId,
    order_token: orderToken,
    order_code: orderCode,
    order_id: orderId,
    ...patch,
  });
  if (!error) return;

  // Webhook e confirmação podem inserir o mesmo token ao mesmo tempo.
  if (error.code === "23505") {
    const raced =
      (await findAttributionBy(admin, input.workspaceId, "order_token", orderToken)) ||
      (await findAttributionBy(admin, input.workspaceId, "order_code", orderCode)) ||
      (await findAttributionBy(admin, input.workspaceId, "order_id", orderId));
    if (raced) {
      const { error: retryError } = await admin
        .from("assistant_attributions")
        .update(patch)
        .eq("id", raced.id);
      if (!retryError) return;
      throw retryError;
    }
  }
  throw error;
}

/** Persiste somente valores vindos do webhook VNDA, nunca do navegador. */
export async function recordAssistantWebhookOrder(
  admin: SupabaseClient,
  input: WebhookOrderInput
): Promise<void> {
  const orderToken = cleanToken(input.orderToken);
  const orderCode = cleanToken(input.orderCode, 64);
  const orderId = cleanToken(input.orderId, 64);
  if (!orderToken && !orderCode) return;

  const confirmed = isConfirmedAssistantOrder(input.status, input.confirmedAt);
  const tokenRow = await findAttributionBy(
    admin,
    input.workspaceId,
    "order_token",
    orderToken
  );
  const codeRow = await findAttributionBy(admin, input.workspaceId, "order_code", orderCode);
  const idRow = await findAttributionBy(admin, input.workspaceId, "order_id", orderId);
  const candidates = [tokenRow, codeRow, idRow].filter(
    (row, index, rows): row is AttributionLookupRow =>
      Boolean(row) && rows.findIndex((other) => other?.id === row?.id) === index
  );
  let existing = candidates[0] || null;

  // A versão anterior criava duas linhas: uma com o token da URL/atk e outra
  // com o code/valor do webhook. Consolida ambas preservando primeiro o vínculo
  // da sessão no registro canônico do webhook; assim uma falha intermediária
  // nunca apaga a atribuição já conhecida.
  if (candidates.length > 1) {
    const target = codeRow || idRow || tokenRow!;
    const mergedAtk = candidates.find((row) => row.atk)?.atk || null;
    const mergedSurface = candidates.find((row) => row.surface)?.surface || null;
    const mergedIsTest = candidates.some((row) => row.isTest);
    const mergedPlacedAt = candidates.find((row) => row.placedAt)?.placedAt || null;
    const { error: preserveError } = await admin
      .from("assistant_attributions")
      .update({
        atk: mergedAtk,
        surface: mergedSurface,
        is_test: mergedIsTest,
        placed_at: mergedPlacedAt,
        source: mergedAtk ? "client_confirmation" : target.source || "webhook",
      })
      .eq("id", target.id);
    if (preserveError) throw preserveError;

    for (const duplicate of candidates.filter((row) => row.id !== target.id)) {
      const { error: deleteError } = await admin
        .from("assistant_attributions")
        .delete()
        .eq("id", duplicate.id);
      if (deleteError) throw deleteError;
    }
    existing = { ...target, atk: mergedAtk };
  }
  const patch: Record<string, unknown> = {
    order_token: orderToken,
    order_code: orderCode,
    order_id: orderId,
    order_status: String(input.status || "").slice(0, 40) || null,
    order_total: input.total,
    order_subtotal: input.subtotal,
    order_discount: input.discount,
    order_shipping: input.shipping,
    order_items: input.items.slice(0, 60),
    revenue_confirmed: confirmed,
  };
  if (input.confirmedAt && Number.isFinite(Date.parse(input.confirmedAt))) {
    patch.confirmed_at = new Date(input.confirmedAt).toISOString();
  } else if (confirmed) {
    patch.confirmed_at = new Date().toISOString();
  }
  if (!existing?.atk) patch.source = "webhook";

  if (existing) {
    const { error } = await admin
      .from("assistant_attributions")
      .update(patch)
      .eq("id", existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await admin.from("assistant_attributions").insert({
    workspace_id: input.workspaceId,
    atk: null,
    surface: null,
    is_test: false,
    confidence: 1,
    ...patch,
  });
  if (!error) return;

  if (error.code === "23505") {
    const raced =
      (await findAttributionBy(admin, input.workspaceId, "order_token", orderToken)) ||
      (await findAttributionBy(admin, input.workspaceId, "order_code", orderCode)) ||
      (await findAttributionBy(admin, input.workspaceId, "order_id", orderId));
    if (raced) {
      const { error: retryError } = await admin
        .from("assistant_attributions")
        .update(patch)
        .eq("id", raced.id);
      if (!retryError) return;
      throw retryError;
    }
  }
  throw error;
}
