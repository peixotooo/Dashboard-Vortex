// Payload do webhook de carrinho abandonado da VNDA.
// VNDA não documenta esse webhook tão formalmente quanto o de orders,
// então mantemos os campos como opcionais e validamos só o mínimo
// (email + algum identificador + items).

export interface VndaAbandonedCartItem {
  id?: number;
  product_id?: number;
  reference?: string;
  product_name?: string;
  name?: string;
  sku?: string;
  variant_name?: string;
  quantity?: number;
  price?: number;
  original_price?: number;
  total?: number;
  image_url?: string;
  images?: Array<{ url?: string } | string>;
  url?: string;
}

export interface VndaAbandonedCartPayload {
  // Identificadores — VNDA pode mandar id numérico, token, ou ambos.
  id?: number | string;
  token?: string;
  cart_token?: string;
  code?: string;

  // Cliente. VNDA real envia first_phone/second_phone (não cellphone/phone)
  // e *não envia nome no payload* — só client_id, que usamos pra enriquecer
  // via GET /api/v2/clients/{id}.
  email?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  client_name?: string;
  phone?: string;
  cellphone?: string;
  phone_area?: string;
  cellphone_area?: string;
  first_phone?: string | null;
  first_phone_area?: string | null;
  second_phone?: string | null;
  second_phone_area?: string | null;
  client_id?: number | null;

  // Conteúdo.
  items?: VndaAbandonedCartItem[];
  products?: VndaAbandonedCartItem[];
  subtotal?: number;
  total?: number;

  // Link de retomada.
  recovery_url?: string;
  cart_url?: string;
  url?: string;

  coupon_code?: string;
  coupon_codes?: string[];

  abandoned_at?: string;
  created_at?: string;
  updated_at?: string;

  extra?: Record<string, unknown>;
}

export interface NormalizedCart {
  vnda_cart_token: string | null;
  vnda_cart_id: string | null;
  vnda_client_id: number | null;
  customer_email: string;
  customer_phone: string | null;
  customer_name: string | null;
  items: NormalizedCartItem[];
  cart_total: number | null;
  recovery_url: string | null;
  coupon_code: string | null;
  abandoned_at: string;
}

export interface NormalizedCartItem {
  name: string | null;
  sku: string | null;
  quantity: number;
  price: number | null;
  image_url: string | null;
}

export type CartRecoveryChannel = "whatsapp" | "email";

export interface CartRecoveryStep {
  id: string;
  workspace_id: string;
  rule_id: string;
  step_order: number;
  delay_minutes: number;
  whatsapp_enabled: boolean;
  whatsapp_template_id: string | null;
  whatsapp_variable_mapping: Record<string, string>;
  email_enabled: boolean;
  email_subject: string | null;
  email_body_html: string | null;
  // 0 = step não gera cupom. > 0 = gera cupom único por carrinho com X%
  // off no carrinho inteiro, válido por coupon_validity_hours.
  coupon_pct: number;
  coupon_validity_hours: number;
}
