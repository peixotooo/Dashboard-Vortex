import type { AssistantHistoryMessage } from "./types";

export type AssistantQualityFlag =
  | "cart_claim_without_action"
  | "garment_measurement_label_corrected"
  | "reply_too_long"
  | "too_many_questions"
  | "unsupported_sales_claim_rephrased";

function normalizeGarmentMeasurement(text: string): { text: string; changed: boolean } {
  const out = text.replace(
    /(\d+(?:[.,]\d+)?)\s*cm\s+de\s+t[oó]rax/gi,
    "$1 cm de largura da peça, medida de axila a axila"
  );
  return { text: out, changed: out !== text };
}

function rephraseUnsupportedSalesClaim(text: string): { text: string; changed: boolean } {
  let out = text;
  const replacements: Array<[RegExp, string]> = [
    [
      /[uú]ltimas pe[cç]as\s*[,;:\-]?\s*(?:e\s+)?est[aã]o voando/gi,
      "Vale conferir as opções disponíveis no seu tamanho",
    ],
    [/est[aã]o voando/gi, "merecem atenção"],
    [/t[aá] bombando/gi, "chama atenção"],
    [/\btrending\b/gi, "atual"],
    [/sa(?:i|em) r[aá]pido/gi, "merecem atenção agora"],
    [/explodem em vendas/gi, "chamam atenção"],
    [/explode em vendas/gi, "chama atenção"],
    [/[uú]ltimas pe[cç]as/gi, "opções disponíveis"],
    [/(?:o\s+)?estoque (?:est[aá]\s+)?baixo/gi, "a disponibilidade varia por tamanho"],
    [/quase esgotad[oa]s?|quase esgotando/gi, "com disponibilidade por tamanho"],
    [/todo mundo (?:est[aá]|t[aá]) levando/gi, "é uma escolha versátil"],
  ];
  for (const [pattern, replacement] of replacements) out = out.replace(pattern, replacement);
  if (/^[a-zà-ÿ]/.test(out)) {
    out = out.charAt(0).toLocaleUpperCase("pt-BR") + out.slice(1);
  }
  return { text: out, changed: out !== text };
}

export function applyAssistantQualityGuard(input: {
  text: string;
  userMessage: string;
  history: AssistantHistoryMessage[];
}): { text: string; flags: AssistantQualityFlag[] } {
  const flags: AssistantQualityFlag[] = [];

  const measurement = normalizeGarmentMeasurement(input.text);
  let text = measurement.text;
  if (measurement.changed) flags.push("garment_measurement_label_corrected");

  const salesClaim = rephraseUnsupportedSalesClaim(text);
  text = salesClaim.text;
  if (salesClaim.changed) flags.push("unsupported_sales_claim_rephrased");

  const claimsCartAction =
    /\b(adicionei|coloquei|inclu[ií]|foi para)\b.{0,45}\b(sacola|carrinho)\b/i.test(text) &&
    !/\b(n[aã]o|ainda n[aã]o)\b.{0,24}\b(adicionei|coloquei|inclu[ií])\b/i.test(text);
  if (claimsCartAction && !/\[\[\s*carrinho\s*:/i.test(text)) {
    text =
      'Não consegui concluir a adição automaticamente. Toque em "Escolher tamanho" no produto para colocá-lo na sacola.';
    flags.push("cart_claim_without_action");
  }

  if ((text.match(/\?/g) || []).length > 2) flags.push("too_many_questions");
  if (text.length > 1400) flags.push("reply_too_long");

  return { text, flags: [...new Set(flags)] };
}
