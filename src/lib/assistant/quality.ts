import type { AssistantHistoryMessage } from "./types";

export type AssistantQualityFlag =
  | "cart_claim_without_action"
  | "high_risk_size_claim_rewritten"
  | "reply_too_long"
  | "too_many_questions"
  | "unsupported_urgency_removed";

function normalized(text: string): string {
  return text
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extractWeightKg(text: string): number | null {
  const values: number[] = [];
  const re = /\b(\d{2,3}(?:[.,]\d)?)\s*(?:kg|kgs|quilo(?:s)?|kilos?|k)(?:\b|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const value = Number(match[1].replace(",", "."));
    if (value >= 35 && value <= 300) values.push(value);
  }
  return values.length ? values[values.length - 1] : null;
}

function softenSizeCertainty(text: string): string {
  return text
    .replace(/\bo tamanho ideal (?:é|seria)\b/gi, "a melhor indicação inicial é")
    .replace(/\bo tamanho perfeito (?:é|seria)\b/gi, "a melhor indicação inicial é")
    .replace(/\b(?:eu\s+)?recomendo o tamanho\b/gi, (_match, offset: number) =>
      offset === 0 ? "Minha indicação inicial é o tamanho" : "minha indicação inicial é o tamanho"
    )
    .replace(/\bgaranto que (?:vai|irá)\b/gi, "a tendência é que vá")
    .replace(/\bvai ficar perfeito\b/gi, "tende a dar o caimento que você descreveu")
    .replace(
      /(\d+(?:[.,]\d+)?)\s*cm\s+de\s+t[oó]rax/gi,
      "$1 cm de largura da peça, medida de axila a axila"
    );
}

function removeUnsupportedUrgency(text: string): { text: string; changed: boolean } {
  let out = text;
  const replacements: Array<[RegExp, string]> = [
    [
      /[uú]ltimas pe[cç]as\s*[,;:\-]?\s*(?:e\s+)?est[aã]o voando/gi,
      "Confira a disponibilidade por tamanho",
    ],
    [/est[aã]o voando/gi, "estão entre os destaques"],
    [/t[aá] bombando/gi, "está entre os destaques"],
    [/\btrending\b/gi, "em destaque"],
    [/sa(?:i|em) r[aá]pido/gi, "têm bastante procura"],
    [/explode(?:m)? em vendas/gi, "estão entre os mais vendidos"],
    [/[uú]ltimas pe[cç]as/gi, "disponibilidade por tamanho"],
    [/estoque baixo/gi, "disponibilidade por tamanho"],
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
  const userContext = [...input.history.filter((m) => m.role === "user").map((m) => m.content), input.userMessage]
    .slice(-8)
    .join("\n");
  const contextNormalized = normalized(userContext);

  let text = input.text;
  const urgency = removeUnsupportedUrgency(text);
  text = urgency.text;
  if (urgency.changed) flags.push("unsupported_urgency_removed");

  const claimsCartAction =
    /\b(adicionei|coloquei|inclu[ií]|foi para)\b.{0,45}\b(sacola|carrinho)\b/i.test(text) &&
    !/\b(n[aã]o|ainda n[aã]o)\b.{0,24}\b(adicionei|coloquei|inclu[ií])\b/i.test(text);
  if (claimsCartAction && !/\[\[\s*carrinho\s*:/i.test(text)) {
    text =
      'Não consegui concluir a adição automaticamente. Toque em "Escolher tamanho" no produto para colocá-lo na sacola.';
    flags.push("cart_claim_without_action");
  }

  const sizeConversation = /tamanho|veste|caimento|altura|peso|medida|just[oa]|larg[oa]|\d\s*kg|quilo/.test(
    contextNormalized
  );
  if (sizeConversation) {
    const weight = extractWeightKg(userContext);
    const hasComparableMeasurement = /axila|largura.{0,25}(camiseta|regata|pe[cç]a)|circunfer[eê]ncia|peito.{0,15}cm|t[oó]rax.{0,15}cm/i.test(
      userContext
    );
    const sizeRecommendationTerms =
      /(?:recomendo|indico|ideal|melhor escolha|vai ficar|ficar[aá]|deve servir|serve bem|[ée] o tamanho)/i;
    const makesRecommendation = new RegExp(
      `\\b(?:xgg|gg|g|m|p)\\b.{0,55}${sizeRecommendationTerms.source}|${sizeRecommendationTerms.source}.{0,55}\\b(?:xgg|gg|g|m|p)\\b`,
      "i"
    ).test(text);
    if (weight !== null && weight >= 105 && !hasComparableMeasurement && makesRecommendation) {
      text =
        `Para eu não te indicar um tamanho no chute: com ${String(weight).replace(".", ",")} kg, ` +
        "altura e peso sozinhos não bastam para comparar com segurança a largura desta peça. " +
        "Qual é a largura, de axila a axila, de uma camiseta ou regata que veste bem em você?";
      flags.push("high_risk_size_claim_rewritten");
    } else {
      text = softenSizeCertainty(text);
    }
  }

  if ((text.match(/\?/g) || []).length > 2) flags.push("too_many_questions");
  if (text.length > 1400) flags.push("reply_too_long");

  return { text, flags: [...new Set(flags)] };
}
