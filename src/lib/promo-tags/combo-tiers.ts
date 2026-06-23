import { normalizePromoTagPages } from "@/lib/promo-tags/modal-metadata";

export interface PromoComboTier {
  quantity: number;
  total: number;
  label?: string;
}

export interface PromoComboTiersConfig {
  enabled: boolean;
  title: string;
  subtitle: string;
  tiers: PromoComboTier[];
}

export const DEFAULT_PROMO_COMBO_TIERS: PromoComboTiersConfig = {
  enabled: false,
  title: "Compre mais, pague menos",
  subtitle: "",
  tiers: [],
};

const COMBO_TIERS_PREFIX = "__combo_tiers:";
const PAGE_TARGETS = new Set(["all", "home", "product", "category", "cart"]);

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toPositiveNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function decodeComboTiersValue(value: string): unknown {
  try {
    return JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }
}

export function normalizePromoTagComboTiers(
  value: unknown
): PromoComboTiersConfig {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_PROMO_COMBO_TIERS, tiers: [] };
  }

  const raw = value as Record<string, unknown>;
  const tiers = Array.isArray(raw.tiers)
    ? raw.tiers
        .map((tier) => {
          const t = tier as Record<string, unknown>;
          return {
            quantity: Math.floor(toPositiveNumber(t.quantity)),
            total: toPositiveNumber(t.total),
            label: cleanText(t.label) || undefined,
          };
        })
        .filter((tier) => tier.quantity > 0 && tier.total > 0)
        .sort((a, b) => a.quantity - b.quantity)
        .slice(0, 8)
    : [];

  return {
    enabled: raw.enabled === true && tiers.length > 0,
    title: cleanText(raw.title) || DEFAULT_PROMO_COMBO_TIERS.title,
    subtitle: cleanText(raw.subtitle),
    tiers,
  };
}

export function extractPromoTagComboTiers(rule: {
  combo_tiers?: unknown;
  show_on_pages?: unknown;
}): PromoComboTiersConfig {
  let direct: PromoComboTiersConfig | null = null;
  if (rule.combo_tiers && typeof rule.combo_tiers === "object") {
    direct = normalizePromoTagComboTiers(rule.combo_tiers);
    if (direct.enabled || direct.tiers.length > 0) return direct;
  }

  const entries = Array.isArray(rule.show_on_pages)
    ? rule.show_on_pages.map(String)
    : [];
  for (const entry of entries) {
    if (!entry.startsWith(COMBO_TIERS_PREFIX)) continue;
    const decoded = decodeComboTiersValue(entry.slice(COMBO_TIERS_PREFIX.length));
    return normalizePromoTagComboTiers(decoded);
  }

  return direct || { ...DEFAULT_PROMO_COMBO_TIERS, tiers: [] };
}

export function withPromoTagComboTiersMetadata(
  showOnPages: unknown,
  comboTiers: unknown
): string[] {
  const raw = Array.isArray(showOnPages) ? showOnPages.map(String) : [];
  const pages = normalizePromoTagPages(raw);
  const existingMetadata = raw.filter(
    (entry) => !PAGE_TARGETS.has(entry) && !entry.startsWith(COMBO_TIERS_PREFIX)
  );
  const combo = normalizePromoTagComboTiers(comboTiers);
  pages.push(...existingMetadata);
  if (combo.enabled) {
    pages.push(`${COMBO_TIERS_PREFIX}${encodeURIComponent(JSON.stringify(combo))}`);
  }
  return pages;
}
