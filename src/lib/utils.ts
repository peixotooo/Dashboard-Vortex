import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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
