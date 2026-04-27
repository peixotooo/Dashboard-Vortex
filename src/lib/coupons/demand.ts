// Demand-aware discount modifier — feeds the picker so smart plans push more
// aggressive discounts when the store is selling slowly and pull back when
// demand is healthy. Lightweight: compares last 7 days of revenue to the
// trailing 7-day mean and returns a multiplier in [0.85, 1.15].

import { createAdminClient } from "@/lib/supabase-admin";

export interface DemandSignal {
  /** Multiplier to apply to discount magnitude. >1 = bigger discount. */
  modifier: number;
  /** Yesterday's revenue (BRL). */
  yesterdayRevenue: number;
  /** Trailing 7-day mean revenue (BRL). */
  trailingMean: number;
  reason: "no_data" | "demand_low" | "demand_high" | "demand_neutral";
}

const FLOOR = 0.85;
const CEILING = 1.15;

export async function getDemandSignal(workspaceId: string): Promise<DemandSignal> {
  const admin = createAdminClient();
  // Get last 8 days of crm_vendas grouped by day; we use day -1 as "yesterday"
  // and days [-8, -2] as the trailing baseline (7-day window).
  const since = new Date(Date.now() - 8 * 24 * 3600_000).toISOString();
  const { data: vendas } = await admin
    .from("crm_vendas")
    .select("valor, data_compra")
    .eq("workspace_id", workspaceId)
    .gte("data_compra", since);
  if (!vendas || vendas.length === 0) {
    return { modifier: 1.0, yesterdayRevenue: 0, trailingMean: 0, reason: "no_data" };
  }

  // Bucket by ISO day
  const byDay = new Map<string, number>();
  for (const v of vendas as Array<{ valor: number | null; data_compra: string }>) {
    const day = v.data_compra.slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + (Number(v.valor) || 0));
  }

  const yesterday = new Date(Date.now() - 1 * 24 * 3600_000).toISOString().slice(0, 10);
  const yesterdayRevenue = byDay.get(yesterday) || 0;

  // Mean over the previous 7 days (day -8 to -2)
  let sum = 0;
  let count = 0;
  for (let i = 2; i <= 8; i++) {
    const day = new Date(Date.now() - i * 24 * 3600_000).toISOString().slice(0, 10);
    sum += byDay.get(day) || 0;
    count++;
  }
  const trailingMean = count > 0 ? sum / count : 0;
  if (trailingMean === 0) {
    return { modifier: 1.0, yesterdayRevenue, trailingMean, reason: "no_data" };
  }

  // ratio = yesterday / mean. If ratio < 1, demand is below average → push more.
  // Symmetric inversion + tight clamp.
  const ratio = yesterdayRevenue / trailingMean;
  // ratio of 0.5 → modifier 1.15 (max push); ratio of 1.5 → modifier 0.85 (pull back)
  const raw = 1 + (1 - ratio) * 0.3;
  const modifier = Math.max(FLOOR, Math.min(CEILING, raw));
  let reason: DemandSignal["reason"] = "demand_neutral";
  if (modifier > 1.05) reason = "demand_low";
  else if (modifier < 0.95) reason = "demand_high";

  return { modifier, yesterdayRevenue, trailingMean, reason };
}
