import type {
  NormalizedCart,
  NormalizedCartItem,
  VndaAbandonedCartItem,
  VndaAbandonedCartPayload,
} from "./types";

export function validateAbandonedCartPayload(
  body: unknown
): body is VndaAbandonedCartPayload {
  if (!body || typeof body !== "object") return false;
  const obj = body as Record<string, unknown>;
  const hasEmail = typeof obj.email === "string" && obj.email.length > 0;
  const hasIdent =
    (typeof obj.token === "string" && obj.token.length > 0) ||
    (typeof obj.cart_token === "string" && obj.cart_token.length > 0) ||
    typeof obj.id === "number" ||
    (typeof obj.id === "string" && obj.id.length > 0);
  const items =
    (obj.items as unknown[] | undefined) ?? (obj.products as unknown[] | undefined);
  const hasItems = Array.isArray(items) && items.length > 0;
  return hasEmail && hasIdent && hasItems;
}

function normalizeItem(it: VndaAbandonedCartItem): NormalizedCartItem {
  // VNDA real envia `images: [{url}, ...]` com dezenas de variantes — pega
  // só a primeira pra preview. `image_url` no formato simples também aceito.
  let imageUrl: string | null = it.image_url || null;
  if (!imageUrl && Array.isArray(it.images) && it.images.length > 0) {
    const first = it.images[0];
    if (typeof first === "string") imageUrl = first;
    else if (first && typeof first.url === "string") imageUrl = first.url;
  }
  return {
    name: it.product_name || it.name || null,
    sku: it.sku || null,
    quantity: Number(it.quantity ?? 1) || 1,
    price: typeof it.price === "number" ? it.price : null,
    image_url: imageUrl,
  };
}

export function normalizeCart(
  payload: VndaAbandonedCartPayload
): NormalizedCart {
  const items = (payload.items || payload.products || []).map(normalizeItem);

  const name =
    payload.name ||
    payload.client_name ||
    [payload.first_name, payload.last_name].filter(Boolean).join(" ").trim() ||
    null;

  // Telefone: VNDA real usa first_phone/second_phone com seus respectivos
  // _area. Os campos cellphone/phone vêm de payloads alternativos / docs
  // antigas e ficam como fallback.
  let phone: string | null = null;
  if (payload.first_phone) {
    phone = `${payload.first_phone_area || ""}${payload.first_phone}`.trim();
  } else if (payload.second_phone) {
    phone = `${payload.second_phone_area || ""}${payload.second_phone}`.trim();
  } else if (payload.cellphone) {
    phone = `${payload.cellphone_area || ""}${payload.cellphone}`.trim();
  } else if (payload.phone) {
    phone = `${payload.phone_area || ""}${payload.phone}`.trim();
  }
  if (phone) phone = phone.replace(/\D/g, "") || null;

  const total =
    typeof payload.total === "number"
      ? payload.total
      : typeof payload.subtotal === "number"
      ? payload.subtotal
      : items.reduce((sum, it) => sum + (it.price ?? 0) * it.quantity, 0) || null;

  // Cupom: VNDA real envia coupon_codes: string[] (vazio quando nenhum).
  const coupon =
    payload.coupon_code ||
    (Array.isArray(payload.coupon_codes) && payload.coupon_codes.length > 0
      ? payload.coupon_codes[0]
      : null);

  return {
    vnda_cart_token:
      payload.token || payload.cart_token || (payload.code ? String(payload.code) : null),
    vnda_cart_id: payload.id != null ? String(payload.id) : null,
    vnda_client_id:
      typeof payload.client_id === "number" ? payload.client_id : null,
    customer_email: String(payload.email || "").toLowerCase().trim(),
    customer_phone: phone,
    customer_name: name,
    items,
    cart_total: total,
    recovery_url: payload.recovery_url || payload.cart_url || payload.url || null,
    coupon_code: coupon,
    abandoned_at:
      payload.abandoned_at ||
      payload.updated_at ||
      payload.created_at ||
      new Date().toISOString(),
  };
}
