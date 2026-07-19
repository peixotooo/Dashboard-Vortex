import type { PspFamily, PspSettings } from "./types";

export const PSP_FAMILIES: PspFamily[] = [
  "camiseta",
  "regata",
  "polo",
  "bermuda",
  "calca",
  "blusao",
  "moletom",
  "jaqueta",
  "acessorio",
  "outro",
];

export const PSP_DEFAULT_SETTINGS: PspSettings = {
  planning_horizon_days: 30,
  safety_stock_days: 7,
  production_lead_days: 10,
  preproduction_days: 7,
  launch_window_days: 60,
  max_rolls_per_order: 25,
  cash_budget_brl: null,
  min_momentum_units_7d: 4,
  growth_threshold_pct: 30,
  family_yields: {
    camiseta: 60,
    regata: 60,
    polo: 45,
    bermuda: 45,
    calca: 30,
    blusao: 30,
    moletom: 30,
    jaqueta: 30,
    acessorio: 30,
    outro: 30,
  },
};

export function parsePspSettings(row: Record<string, unknown> | null | undefined): PspSettings {
  const integer = (key: keyof PspSettings, fallback: number) => {
    const value = Number(row?.[key]);
    return Number.isFinite(value) ? Math.round(value) : fallback;
  };
  const rawYields = row?.family_yields;
  const yields =
    rawYields && typeof rawYields === "object" && !Array.isArray(rawYields)
      ? (rawYields as Record<string, unknown>)
      : {};

  const familyYields = { ...PSP_DEFAULT_SETTINGS.family_yields };
  for (const family of PSP_FAMILIES) {
    const value = Number(yields[family]);
    if (Number.isFinite(value) && value >= 1) familyYields[family] = Math.round(value);
  }

  const rawBudget = row?.cash_budget_brl;
  const parsedBudget = rawBudget == null || rawBudget === "" ? null : Number(rawBudget);

  return {
    planning_horizon_days: integer(
      "planning_horizon_days",
      PSP_DEFAULT_SETTINGS.planning_horizon_days
    ),
    safety_stock_days: integer("safety_stock_days", PSP_DEFAULT_SETTINGS.safety_stock_days),
    production_lead_days: integer(
      "production_lead_days",
      PSP_DEFAULT_SETTINGS.production_lead_days
    ),
    preproduction_days: integer(
      "preproduction_days",
      PSP_DEFAULT_SETTINGS.preproduction_days
    ),
    launch_window_days: integer("launch_window_days", PSP_DEFAULT_SETTINGS.launch_window_days),
    max_rolls_per_order: integer(
      "max_rolls_per_order",
      PSP_DEFAULT_SETTINGS.max_rolls_per_order
    ),
    cash_budget_brl:
      parsedBudget != null && Number.isFinite(parsedBudget) && parsedBudget >= 0
        ? parsedBudget
        : null,
    min_momentum_units_7d: integer(
      "min_momentum_units_7d",
      PSP_DEFAULT_SETTINGS.min_momentum_units_7d
    ),
    growth_threshold_pct: Number.isFinite(Number(row?.growth_threshold_pct))
      ? Number(row?.growth_threshold_pct)
      : PSP_DEFAULT_SETTINGS.growth_threshold_pct,
    family_yields: familyYields,
  };
}
