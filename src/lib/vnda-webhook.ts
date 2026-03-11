import { randomUUID } from "crypto";

// --- Payload types (based on VNDA order confirmed webhook) ---

export interface VndaWebhookItem {
  id: number;
  reference: string;
  product_name: string;
  sku: string;
  variant_name: string;
  quantity: number;
  price: number;
  original_price: number;
  total: number;
  weight: number;
  attribute1?: string | null;
  attribute2?: string | null;
  attribute3?: string | null;
  barcode?: string;
  seller?: string;
}

export interface VndaWebhookDiscount {
  name: string;
  valid_to: string;
  apply_to: string;
  type: string;
  value: number;
  package: string | null;
  sku: string | null;
}

export interface VndaWebhookPayload {
  id: number;
  code: string;
  token: string;
  status: string;
  first_name: string;
  last_name: string;
  email: string;
  cpf?: string;
  zip?: string;
  street_name?: string;
  street_number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  client_id?: number;
  client_tags?: string | null;
  payment_method?: string;
  subtotal: number;
  discount_price: number;
  total: number;
  taxes: number;
  updated_at?: string;
  received_at?: string;
  confirmed_at?: string;
  canceled_at?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  installments?: number;
  payment_gateway?: string;
  phone_area?: string;
  phone?: string;
  cellphone_area?: string | null;
  cellphone?: string | null;
  coupon_code?: string | null;
  channel?: string;
  items: VndaWebhookItem[];
  discounts?: VndaWebhookDiscount[];
  shipping_address?: {
    first_name?: string;
    last_name?: string;
    street_name?: string;
    street_number?: string;
    complement?: string;
    neighborhood?: string;
    zip?: string;
    city?: string;
    state?: string;
    recipient_name?: string;
    phone?: string;
  };
  birthdate?: string | null;
  shipping_method?: string;
  shipping_label?: string;
  shipping_price?: number;
  delivery_days?: number;
  tracking_code?: string | null;
  extra?: Record<string, unknown>;
}

// --- Map payload to crm_vendas row ---

export function mapVndaPayloadToCrmRow(
  payload: VndaWebhookPayload,
  workspaceId: string
) {
  const clientName = [payload.first_name, payload.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  const phone = payload.phone
    ? `${payload.phone_area || ""}${payload.phone}`.trim()
    : payload.shipping_address?.phone || null;

  // Normalize payment method
  let paymentMethod: string | null = null;
  if (payload.payment_method) {
    const pm = payload.payment_method.toLowerCase();
    if (pm.includes("pix")) paymentMethod = "pix";
    else if (pm.includes("cart") || pm.includes("credit") || pm.includes("crédito"))
      paymentMethod = "credit_card";
    else if (pm.includes("boleto")) paymentMethod = "boleto";
    else if (pm.includes("debit") || pm.includes("débito"))
      paymentMethod = "debit_card";
    else paymentMethod = payload.payment_method;
  }

  // Map items to compact JSON
  const items = (payload.items || []).map((item) => ({
    name: item.product_name,
    sku: item.sku,
    quantity: item.quantity,
    price: item.price,
    original_price: item.original_price,
    total: item.total,
  }));

  // Map discounts
  const discounts = (payload.discounts || []).map((d) => ({
    name: d.name,
    type: d.type,
    value: d.value,
    apply_to: d.apply_to,
    sku: d.sku,
  }));

  // Parse birthdate
  let birthdate: string | null = null;
  if (payload.birthdate) {
    const parsed = new Date(payload.birthdate);
    if (!isNaN(parsed.getTime())) {
      birthdate = parsed.toISOString().slice(0, 10);
    }
  }

  return {
    workspace_id: workspaceId,
    cliente: clientName || null,
    email: payload.email || null,
    telefone: phone,
    valor: payload.total ?? 0,
    data_compra: payload.confirmed_at || payload.received_at || new Date().toISOString(),
    cupom: payload.coupon_code || null,
    numero_pedido: payload.code || null,
    compras_anteriores: 0, // will be enriched later if needed
    source: "vnda_webhook" as const,
    source_order_id: String(payload.id),
    cpf: payload.cpf || null,
    birthdate,
    state: payload.shipping_address?.state || payload.state || null,
    city: payload.shipping_address?.city || payload.city || null,
    zip: payload.shipping_address?.zip || payload.zip || null,
    neighborhood: payload.shipping_address?.neighborhood || payload.neighborhood || null,
    payment_method: paymentMethod,
    installments: payload.installments ?? null,
    shipping_method: payload.shipping_method || null,
    shipping_price: payload.shipping_price ?? null,
    delivery_days: payload.delivery_days ?? null,
    subtotal: payload.subtotal ?? null,
    discount_price: payload.discount_price ?? null,
    channel: payload.channel || null,
    items: items.length > 0 ? items : null,
    discounts: discounts.length > 0 ? discounts : null,
  };
}

// --- Validation ---

export function validateWebhookPayload(
  body: unknown
): body is VndaWebhookPayload {
  if (!body || typeof body !== "object") return false;
  const obj = body as Record<string, unknown>;
  return (
    typeof obj.id === "number" &&
    typeof obj.email === "string" &&
    obj.email.length > 0 &&
    typeof obj.total === "number"
  );
}

// --- Token ---

export function generateWebhookToken(): string {
  return randomUUID();
}
