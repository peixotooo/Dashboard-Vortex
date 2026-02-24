import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { DatePreset } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | string, currency = "BRL"): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(num);
}

// For Meta API budget fields that return values in cents (daily_budget, lifetime_budget)
export function formatBudget(value: number | string, currency = "BRL"): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(num / 100);
}

export function formatNumber(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  return new Intl.NumberFormat("pt-BR").format(num);
}

export function formatPercent(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0%";
  return `${num.toFixed(2)}%`;
}

export function formatCompact(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(0);
}

export function getPreviousPeriodDates(preset: DatePreset): { since: string; until: string } {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  function subtractDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() - days);
    return d;
  }

  switch (preset) {
    case "today": {
      const yesterday = subtractDays(today, 1);
      return { since: fmt(yesterday), until: fmt(yesterday) };
    }
    case "yesterday": {
      const d = subtractDays(today, 2);
      return { since: fmt(d), until: fmt(d) };
    }
    case "last_7d": {
      return { since: fmt(subtractDays(today, 14)), until: fmt(subtractDays(today, 8)) };
    }
    case "last_14d": {
      return { since: fmt(subtractDays(today, 28)), until: fmt(subtractDays(today, 15)) };
    }
    case "last_30d": {
      return { since: fmt(subtractDays(today, 60)), until: fmt(subtractDays(today, 31)) };
    }
    case "last_90d": {
      return { since: fmt(subtractDays(today, 180)), until: fmt(subtractDays(today, 91)) };
    }
    case "this_month": {
      const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastMonthEnd = subtractDays(firstOfMonth, 1);
      return { since: fmt(lastMonth), until: fmt(lastMonthEnd) };
    }
    case "last_month": {
      const firstOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const twoMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 2, 1);
      const twoMonthsAgoEnd = subtractDays(firstOfLastMonth, 1);
      return { since: fmt(twoMonthsAgo), until: fmt(twoMonthsAgoEnd) };
    }
    default: {
      return { since: fmt(subtractDays(today, 60)), until: fmt(subtractDays(today, 31)) };
    }
  }
}

export function getStatusColor(status: string): string {
  switch (status?.toUpperCase()) {
    case "ACTIVE":
      return "text-success";
    case "PAUSED":
      return "text-warning";
    case "DELETED":
    case "ARCHIVED":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

export function getStatusBadgeClasses(status: string): string {
  switch (status?.toUpperCase()) {
    case "ACTIVE":
      return "bg-success/10 text-success border-success/20";
    case "PAUSED":
      return "bg-warning/10 text-warning border-warning/20";
    case "DELETED":
    case "ARCHIVED":
      return "bg-destructive/10 text-destructive border-destructive/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}
