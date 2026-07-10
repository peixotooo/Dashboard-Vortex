export const FREE_SHIPPING_THRESHOLD_BRL = 299;

export const FREE_SHIPPING_THRESHOLDS_BRL: Record<string, number> = {
  Sul: 299,
  Sudeste: 299,
  "Centro-Oeste": 299,
  Nordeste: 345,
  Norte: 345,
};

const STATE_TO_REGION: Record<string, string> = {
  PR: "Sul",
  RS: "Sul",
  SC: "Sul",
  ES: "Sudeste",
  MG: "Sudeste",
  RJ: "Sudeste",
  SP: "Sudeste",
  DF: "Centro-Oeste",
  GO: "Centro-Oeste",
  MS: "Centro-Oeste",
  MT: "Centro-Oeste",
  AL: "Nordeste",
  BA: "Nordeste",
  CE: "Nordeste",
  MA: "Nordeste",
  PB: "Nordeste",
  PE: "Nordeste",
  PI: "Nordeste",
  RN: "Nordeste",
  SE: "Nordeste",
  AC: "Norte",
  AM: "Norte",
  AP: "Norte",
  PA: "Norte",
  RO: "Norte",
  RR: "Norte",
  TO: "Norte",
};

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function normalizeBrazilianState(raw: unknown): string | null {
  const value = String(raw || "").trim().toUpperCase();
  if (!value) return null;
  const letters = value.replace(/[^A-Z]/g, "");
  if (letters.length === 2 && STATE_TO_REGION[letters]) return letters;
  return null;
}

export function regionForState(state: string | null | undefined): string | null {
  const normalized = normalizeBrazilianState(state);
  return normalized ? STATE_TO_REGION[normalized] || null : null;
}

export function isFreeShippingRegion(
  stateOrRegion: string | null | undefined
): boolean {
  return freeShippingThresholdForRegion(stateOrRegion) != null;
}

export function freeShippingThresholdForRegion(
  stateOrRegion: string | null | undefined,
  thresholds: Record<string, number> = FREE_SHIPPING_THRESHOLDS_BRL
): number | null {
  const region = regionForState(stateOrRegion) || String(stateOrRegion || "").trim();
  const threshold = Number(thresholds[region]);
  return Number.isFinite(threshold) && threshold > 0 ? threshold : null;
}

export function buildFreeShippingMessage(input: {
  state?: string | null;
  region?: string | null;
  cartTotal?: number | null;
}): string {
  const region = input.region || regionForState(input.state);
  const threshold = freeShippingThresholdForRegion(region);
  if (threshold == null) return "";

  const thresholdFormatted = BRL.format(threshold);
  const cartTotal = Number(input.cartTotal || 0);

  if (cartTotal >= threshold) {
    return `Boa notícia: seu carrinho já entra na condição de frete grátis para ${region}.`;
  }

  return `Para ${region}, pedidos acima de ${thresholdFormatted} têm frete grátis.`;
}
