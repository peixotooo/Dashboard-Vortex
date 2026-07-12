import type {
  AssistantHistoryMessage,
  AssistantProductDetails,
  AssistantSizeAvailability,
} from "./types";

export type SizePreference = "fitted" | "loose";

export interface CustomerSizeProfile {
  heightCm: number;
  weightKg: number;
  preference: SizePreference;
}

export interface DeterministicSizeRecommendation {
  primary: string | null;
  alternative: string | null;
  compatiblePair: [string, string];
  preference: SizePreference;
  allCompatibleUnavailable: boolean;
}

const SIZE_PAIRS: Array<[string, string]> = [
  ["P", "M"],
  ["M", "G"],
  ["G", "GG"],
  ["GG", "XGG"],
];

function normalized(text: string): string {
  return text
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function lastNumber(text: string, patterns: RegExp[]): number | null {
  let selected: { index: number; value: number } | null = null;
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(String(match[1]).replace(",", "."));
      if (Number.isFinite(value) && (!selected || (match.index || 0) >= selected.index)) {
        selected = { index: match.index || 0, value };
      }
    }
  }
  return selected?.value ?? null;
}

function lastPreference(text: string): SizePreference | null {
  const n = normalized(text);
  let fitted = -1;
  let loose = -1;
  for (const match of n.matchAll(/certinh[oa]?|just[oa]?|ajustad[oa]?|colad[oa]?/g)) {
    fitted = Math.max(fitted, match.index || 0);
  }
  for (const match of n.matchAll(/folgad[oa]?|larg[oa]?|ampl[oa]?|solt[oa]?/g)) {
    loose = Math.max(loose, match.index || 0);
  }
  if (fitted < 0 && loose < 0) return null;
  return fitted > loose ? "fitted" : "loose";
}

export function extractCustomerSizeProfile(
  history: AssistantHistoryMessage[],
  userMessage: string
): CustomerSizeProfile | null {
  const context = [
    ...history.filter((message) => message.role === "user").map((message) => message.content),
    userMessage,
  ]
    .slice(-8)
    .join("\n");

  const heightMeters = lastNumber(context, [
    /\b(1[.,]\d{2}|2[.,][0-1]\d)\s*m(?:etro)?s?\b/gi,
    /\baltura\D{0,12}(1[.,]\d{2}|2[.,][0-1]\d)\b/gi,
  ]);
  const heightCentimeters = lastNumber(context, [
    /\b(1[4-9]\d|2[0-1]\d)\s*cm\b/gi,
  ]);
  const weight = lastNumber(context, [
    /\b(\d{2,3}(?:[.,]\d)?)\s*(?:kg|kgs|quilo(?:s)?|kilos?)\b/gi,
  ]);
  const preference = lastPreference(context);
  const heightCm = heightCentimeters ?? (heightMeters !== null ? heightMeters * 100 : null);

  if (
    heightCm === null ||
    heightCm < 140 ||
    heightCm > 220 ||
    weight === null ||
    weight < 35 ||
    weight > 250 ||
    !preference
  ) {
    return null;
  }

  return {
    heightCm: Math.round(heightCm),
    weightKg: Math.round(weight * 10) / 10,
    preference,
  };
}

function profileBand(profile: CustomerSizeProfile): number {
  const weightBand =
    profile.weightKg <= 70 ? 0 : profile.weightKg <= 85 ? 1 : profile.weightKg <= 100 ? 2 : 3;
  // Altura influencia comprimento, mas sozinha nunca leva à faixa GG/XGG.
  const heightBand = profile.heightCm <= 170 ? 0 : profile.heightCm <= 180 ? 1 : 2;
  return Math.max(weightBand, heightBand);
}

export function recommendDeterministicSize(
  profile: CustomerSizeProfile,
  sizes: AssistantSizeAvailability[] = []
): DeterministicSizeRecommendation {
  const compatiblePair = SIZE_PAIRS[profileBand(profile)];
  const preferred = profile.preference === "fitted" ? compatiblePair[0] : compatiblePair[1];
  const other = profile.preference === "fitted" ? compatiblePair[1] : compatiblePair[0];
  const hasAvailability = sizes.length > 0;
  const available = new Set(
    sizes.filter((size) => size.available).map((size) => size.size.toUpperCase())
  );
  const isAvailable = (size: string) => !hasAvailability || available.has(size);
  const primary = isAvailable(preferred) ? preferred : isAvailable(other) ? other : null;
  const alternative = primary && other !== primary && isAvailable(other) ? other : null;

  return {
    primary,
    alternative,
    compatiblePair,
    preference: profile.preference,
    allCompatibleUnavailable: primary === null,
  };
}

function measurementFor(sizeGuide: string | null, size: string): string | null {
  if (!sizeGuide) return null;
  const escaped = size.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const line = sizeGuide
    .split("\n")
    .find((candidate) => new RegExp(`^\\s*${escaped}\\s*:`, "i").test(candidate));
  if (!line) return null;
  const length = line.match(/(\d+(?:[.,]\d+)?)\s*cm\s+de\s+comprimento/i)?.[1];
  const width = line.match(/(\d+(?:[.,]\d+)?)\s*cm\s+de\s+(?:t[oó]rax|largura)/i)?.[1];
  if (length && width) {
    return `${length} cm de comprimento e ${width} cm de largura da peça, medida de axila a axila`;
  }
  return line.replace(/^\s*[^:]+:\s*/, "").replace(/cm\s+de\s+t[oó]rax/gi, "cm de largura da peça");
}

export function buildDeterministicSizeReply(input: {
  product: AssistantProductDetails;
  profile: CustomerSizeProfile;
}): { reply: string; recommendation: DeterministicSizeRecommendation } {
  const recommendation = recommendDeterministicSize(input.profile, input.product.sizes);
  const height = (input.profile.heightCm / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const weight = input.profile.weightKg.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const desiredFit = input.profile.preference === "fitted" ? "mais certinho" : "mais folgado";

  if (!recommendation.primary) {
    const [smaller, larger] = recommendation.compatiblePair;
    return {
      recommendation,
      reply:
        `Para ${height} m e ${weight} kg, a faixa coerente nesta modelagem é ${smaller}/${larger}, ` +
        `mas esses tamanhos estão indisponíveis nesta peça agora. Não vou te empurrar um tamanho fora da faixa. ` +
        "Posso buscar uma opção parecida disponível para você.",
    };
  }

  const primaryMeasurement = measurementFor(input.product.sizeGuide, recommendation.primary);
  const alternativeMeasurement = recommendation.alternative
    ? measurementFor(input.product.sizeGuide, recommendation.alternative)
    : null;
  const parts = [
    `Para ${height} m e ${weight} kg, como você prefere o caimento ${desiredFit}, recomendo **${recommendation.primary}** nesta peça.`,
  ];
  if (primaryMeasurement) {
    parts.push(`No ${recommendation.primary}, ela tem ${primaryMeasurement}.`);
  }
  if (recommendation.alternative) {
    const alternativeFit = input.profile.preference === "fitted" ? "mais folgado" : "mais certinho";
    parts.push(
      `Se quiser o caimento ${alternativeFit}, escolha **${recommendation.alternative}**` +
        (alternativeMeasurement ? `, com ${alternativeMeasurement}` : "") +
        "."
    );
  }
  parts.push(`Quer que eu adicione o tamanho ${recommendation.primary} à sua sacola?`);

  return { reply: parts.join("\n\n"), recommendation };
}

export function hasSizingIntent(history: AssistantHistoryMessage[], userMessage: string): boolean {
  const context = [
    ...history.slice(-4).map((message) => message.content),
    userMessage,
  ].join(" ");
  return /tamanho|veste|servir|caimento|certinh|folgad|just[oa]|ajustad/i.test(context);
}
