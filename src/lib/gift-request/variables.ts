// Variáveis disponíveis no template WhatsApp do "Pedir de presente".
// Mesmo formato do cart-recovery (mapping posicional {{1}}, {{2}}…)
// e helpers de encode/parse pra UI.

import {
  encodeMappingValue,
  parseMappingValue,
  resolveWhatsAppVariables as resolveBase,
  previewWhatsAppBody as previewBase,
  type MappingKind,
} from "@/lib/cart-recovery/variables";

export interface GiftRequestRow {
  requester_name: string;
  requester_phone: string | null;
  recipient_phone: string;
  product_id: string;
  product_name: string | null;
  product_url: string | null;
  product_price: number | null;
  personal_message: string | null;
}

export interface GiftRequestVariables {
  requester_name: string;
  requester_first_name: string;
  requester_phone: string;
  recipient_phone: string;
  product_id: string;
  product_name: string;
  product_url: string;
  product_price: string;
  product_price_formatted: string;
  personal_message: string;
  store_name: string;
}

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function buildGiftRequestVariables(
  row: GiftRequestRow,
  opts: { storeName?: string } = {}
): GiftRequestVariables {
  const firstName = (row.requester_name || "").split(/\s+/)[0] || "";
  const price = row.product_price ?? 0;
  return {
    requester_name: row.requester_name || "",
    requester_first_name: firstName,
    requester_phone: row.requester_phone || "",
    recipient_phone: row.recipient_phone,
    product_id: row.product_id,
    product_name: row.product_name || "",
    product_url: row.product_url || "",
    product_price: price ? price.toFixed(2) : "",
    product_price_formatted: price ? BRL.format(price) : "",
    personal_message: row.personal_message || "",
    store_name: opts.storeName || "",
  };
}

export const GIFT_REQUEST_VARS = [
  "requester_name",
  "requester_first_name",
  "requester_phone",
  "recipient_phone",
  "product_name",
  "product_url",
  "product_price_formatted",
  "personal_message",
  "store_name",
] as const;

export const SAMPLE_GIFT_VARS: GiftRequestVariables = {
  requester_name: "Maria Souza",
  requester_first_name: "Maria",
  requester_phone: "+5511999998888",
  recipient_phone: "+5511988887777",
  product_id: "775846220",
  product_name: "Camiseta Hustle III",
  product_url: "https://loja.com/produto/camiseta-hustle-iii-775846220",
  product_price: "199.90",
  product_price_formatted: "R$ 199,90",
  personal_message: "Tô amando essa! Aniversário chegando ✨",
  store_name: "Sua Loja",
};

// Reusa o mesmo encoder/parser/resolver/preview do cart-recovery — formato
// idêntico (var:foo, text:bar) — só com o set de variáveis diferente.
export {
  encodeMappingValue,
  parseMappingValue,
  type MappingKind,
};

export function resolveWhatsAppVariables(
  mapping: Record<string, string>,
  vars: GiftRequestVariables
): Record<string, string> {
  // resolveBase espera o shape de RecoveryVariables, mas só lê chaves por
  // string. Cast porque o conjunto de chaves é diferente mas o lookup é o mesmo.
  return resolveBase(
    mapping,
    vars as unknown as Parameters<typeof resolveBase>[1]
  );
}

export function previewWhatsAppBody(
  templateBody: string,
  mapping: Record<string, string>,
  vars: GiftRequestVariables
): string {
  return previewBase(
    templateBody,
    mapping,
    vars as unknown as Parameters<typeof previewBase>[2]
  );
}
