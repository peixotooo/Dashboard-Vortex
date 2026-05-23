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
//
// Cada slot do mapping aceita 3 formatos:
//   "var:customer_first_name"  → resolve a variável
//   "text:Aproveite 10%"       → texto literal
//   "customer_first_name"      → legado (sem prefixo) = variável
export function resolveWhatsAppVariables(
  mapping: Record<string, string>,
  vars: RecoveryVariables
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [position, raw] of Object.entries(mapping || {})) {
    out[position] = resolveMappingValue(raw, vars);
  }
  return out;
}

function resolveMappingValue(
  raw: string,
  vars: RecoveryVariables
): string {
  if (!raw) return "";
  // Texto livre suporta interpolação {{var_name}} também — necessário pra
  // estratégia de template UTILITY genérico (body do template fica só
  // "{{1}}\n\n{{2}}" pra Meta classificar como UTILITY, e o texto real
  // — com nome do cliente, escassez, etc — vai como mapping text: com
  // interpolação de variáveis).
  if (raw.startsWith("text:")) return interpolate(raw.slice(5), vars);
  const varName = raw.startsWith("var:") ? raw.slice(4) : raw;
  const value = (vars as unknown as Record<string, string>)[varName];
  return value ?? "";
}

// Helpers pra UI — separa o tipo do valor do mapping.
export type MappingKind = "var" | "text";

export function parseMappingValue(raw: string): {
  kind: MappingKind;
  value: string;
} {
  if (!raw) return { kind: "var", value: "" };
  if (raw.startsWith("text:")) return { kind: "text", value: raw.slice(5) };
  if (raw.startsWith("var:")) return { kind: "var", value: raw.slice(4) };
  return { kind: "var", value: raw };
}

export function encodeMappingValue(kind: MappingKind, value: string): string {
  return `${kind}:${value}`;
}

// Valores de exemplo pra preview na UI (sem cart real).
export const SAMPLE_VARS: RecoveryVariables = {
  customer_name: "João Silva",
  customer_first_name: "João",
  customer_email: "joao@exemplo.com",
  cart_total: "199.90",
  cart_total_formatted: "R$ 199,90",
  first_item_name: "Camiseta Hustle III",
  items_count: "2",
  recovery_url: "https://loja.com/cart/abc123",
  coupon_code: "VOLTA10",
  store_name: "Sua Loja",
};

// Renderiza o body de um template WhatsApp substituindo {{1}}, {{2}}...
// pelos valores do mapping resolvidos com `vars` (use SAMPLE_VARS pra preview).
export function previewWhatsAppBody(
  templateBody: string,
  mapping: Record<string, string>,
  vars: RecoveryVariables
): string {
  if (!templateBody) return "";
  const resolved = resolveWhatsAppVariables(mapping, vars);
  return templateBody.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, pos) => {
    return resolved[pos] || match;
  });
}

// Interpola {{var_name}} em strings (assunto e HTML do email).
export function interpolate(template: string, vars: RecoveryVariables): string {
  if (!template) return "";
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, name) => {
    const value = (vars as unknown as Record<string, string>)[name];
    return value != null ? value : "";
  });
}
