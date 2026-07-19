import type { AdAccountFunding } from "@/lib/meta-api";

export type MetaBalanceAlertLevel = "ok" | "warn" | "critical";

export interface MetaBalanceThresholds {
  warnHours: number;
  criticalHours: number;
}

export function parseMetaBalanceThresholds(
  warnValue: string | undefined,
  criticalValue: string | undefined,
): MetaBalanceThresholds {
  const warnHours = Number(warnValue || 2.5);
  const criticalHours = Number(criticalValue || 1);

  if (
    !Number.isFinite(warnHours) ||
    !Number.isFinite(criticalHours) ||
    criticalHours <= 0 ||
    warnHours <= criticalHours
  ) {
    throw new Error(
      "Invalid Meta balance thresholds: warn must be greater than critical and both must be positive",
    );
  }

  return { warnHours, criticalHours };
}

export function classifyMetaBalance(
  runwayHours: number,
  thresholds: MetaBalanceThresholds,
): MetaBalanceAlertLevel {
  if (!Number.isFinite(runwayHours)) return "ok";
  if (runwayHours < 0) throw new Error("Runway cannot be negative");
  if (runwayHours <= thresholds.criticalHours) return "critical";
  if (runwayHours <= thresholds.warnHours) return "warn";
  return "ok";
}

export function metaBalanceLevelRank(level: string): number {
  if (level === "critical") return 2;
  if (level === "warn") return 1;
  return 0;
}

export function formatBrl(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid BRL value");
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  })
    .format(value)
    .replace(/[\u00a0\u202f]/g, " ");
}

export function formatRunway(runwayHours: number): string {
  if (!Number.isFinite(runwayHours)) return "sem consumo recente";
  if (runwayHours < 0) throw new Error("Runway cannot be negative");

  const totalMinutes = Math.max(1, Math.round(runwayHours * 60));
  if (totalMinutes < 60) {
    return `${totalMinutes} ${totalMinutes === 1 ? "minuto" : "minutos"}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}min`;
}

export function suggestMetaTopup(dailyBurnBrl: number): number {
  if (!Number.isFinite(dailyBurnBrl) || dailyBurnBrl < 0) {
    throw new Error("Invalid daily burn");
  }

  const amountForEightHours = (dailyBurnBrl / 24) * 8;
  const rounded = Math.ceil(amountForEightHours / 500) * 500;
  return Math.min(1000, Math.max(500, rounded || 500));
}

export function buildMetaBalanceTemplateVariables(
  accountName: string,
  funding: AdAccountFunding,
): Record<string, string> {
  return {
    "1": accountName,
    "2": formatBrl(funding.availableBrl),
    "3": formatRunway(funding.runwayHours),
    // The approved template already appends "por dia" after variable 4.
    "4": formatBrl(funding.dailyBurnBrl),
    "5": formatBrl(suggestMetaTopup(funding.dailyBurnBrl)),
  };
}
