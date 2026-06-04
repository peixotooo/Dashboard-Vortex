import type { CashbackConfigRow, CashbackStage } from "./api";

export const CASHBACK_ADOPTION_TARGET_RATE = 0.1;

export const ACTIVE_REMINDER_STAGES: CashbackStage[] = [
  "LEMBRETE_1",
  "LEMBRETE_2",
  "LEMBRETE_3",
];

export function secondReminderAfterDepositDays(cfg: Pick<CashbackConfigRow, "deposit_delay_days" | "reminder_2_day">): number {
  const raw = Number(cfg.reminder_2_day || 5);
  if (!Number.isFinite(raw) || raw <= 0) return 5;

  // Legacy configs stored this as "day since original order".
  // New configs store the operational intent: D+n after deposit.
  if (raw > Number(cfg.deposit_delay_days || 0)) {
    return Math.max(1, Math.round(raw - Number(cfg.deposit_delay_days || 0)));
  }
  return Math.max(1, Math.round(raw));
}

export function finalReminderBeforeExpiryDays(cfg: Pick<CashbackConfigRow, "reminder_3_day">): number {
  const raw = Number(cfg.reminder_3_day || 3);
  if (!Number.isFinite(raw) || raw <= 0) return 3;

  // Values up to a week mean D-n before expiration. Older values such as 29
  // meant "day 29 of a 30-day validity", so keep them as a one-day fallback.
  if (raw <= 7) return Math.max(1, Math.round(raw));
  return 1;
}

export function stageTimingLabel(stage: CashbackStage, cfg: CashbackConfigRow): string {
  if (stage === "LEMBRETE_1") return "no depósito";
  if (stage === "LEMBRETE_2") return `D+${secondReminderAfterDepositDays(cfg)} após depósito`;
  if (stage === "LEMBRETE_3") return `D-${finalReminderBeforeExpiryDays(cfg)} antes de expirar`;
  if (stage === "REATIVACAO_LEMBRETE") return `D-${cfg.reactivation_days - cfg.reactivation_reminder_day} da reativação`;
  return "reativação manual";
}

export function daysAgoIso(days: number): string {
  const out = new Date();
  out.setUTCDate(out.getUTCDate() - days);
  return out.toISOString();
}

export function daysAheadIso(days: number): string {
  const out = new Date();
  out.setUTCDate(out.getUTCDate() + days);
  return out.toISOString();
}
