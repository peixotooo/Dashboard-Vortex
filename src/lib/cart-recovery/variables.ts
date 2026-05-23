// Resolve as variáveis disponíveis em mensagens de recuperação de carrinho.
// Usado pra:
// - mapear placeholders posicionais do WhatsApp ({{1}}, {{2}}) via
//   step.whatsapp_variable_mapping
// - interpolar {{var_name}} no assunto e corpo HTML do email

import type { NormalizedCartItem } from "./types";

export interface CartRow {
  customer_email: string;
  customer_name: string | null;
  customer_phone: string | null;
  cart_total: number | null;
  items: NormalizedCartItem[] | null;
  recovery_url: string | null;
  coupon_code: string | null;
}

export interface RecoveryVariables {
  customer_name: string;
  customer_first_name: string;
  customer_email: string;
  cart_total: string;
  cart_total_formatted: string;
  first_item_name: string;
  items_count: string;
  recovery_url: string;
  coupon_code: string;
  store_name: string;
}

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function buildRecoveryVariables(
  cart: CartRow,
  opts: { storeName?: string } = {}
): RecoveryVariables {
  const items = cart.items ?? [];
  const firstName = (cart.customer_name || "").split(/\s+/)[0] || "";
  const total = cart.cart_total ?? 0;
  return {
    customer_name: cart.customer_name || "",
    customer_first_name: firstName,
    customer_email: cart.customer_email,
    cart_total: total.toFixed(2),
    cart_total_formatted: BRL.format(total),
    first_item_name: items[0]?.name || "",
    items_count: String(items.length),
    recovery_url: cart.recovery_url || "",
    coupon_code: cart.coupon_code || "",
    store_name: opts.storeName || "",
  };
}

// Resolve mapping posicional → { "1": "<value>", "2": "<value>" }
// Esse formato é o que wa_messages.variable_values espera (consumido por
// sendTemplateMessage que substitui em {{1}}, {{2}}).
export function resolveWhatsAppVariables(
  mapping: Record<string, string>,
  vars: RecoveryVariables
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [position, varName] of Object.entries(mapping || {})) {
    const value = (vars as unknown as Record<string, string>)[varName];
    out[position] = value ?? "";
  }
  return out;
}

// Interpola {{var_name}} em strings (assunto e HTML do email).
export function interpolate(template: string, vars: RecoveryVariables): string {
  if (!template) return "";
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, name) => {
    const value = (vars as unknown as Record<string, string>)[name];
    return value != null ? value : "";
  });
}
