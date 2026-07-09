import { createAdminClient } from "@/lib/supabase-admin";
import type { VndaReport, VndaTotals } from "@/lib/vnda-api";
import type { DatePreset } from "@/lib/types";

type CrmSaleRow = {
  valor: number | string | null;
  data_compra: string | null;
  shipping_price?: number | string | null;
  discount_price?: number | string | null;
  items?: unknown;
};

const CHUNK = 1000;
const HARD_CAP = 50000;
const STORE_TZ = "America/Sao_Paulo";

function toNumber(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 0;
  return Number.isFinite(n) ? n : 0;
}

function saoPauloDateKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value || "0000";
  const m = parts.find((p) => p.type === "month")?.value || "00";
  const d = parts.find((p) => p.type === "day")?.value || "00";
  return `${y}-${m}-${d}`;
}

function dateToDisplay(dateRaw: string): string {
  return `${dateRaw.slice(8, 10)}/${dateRaw.slice(5, 7)}`;
}

function dateKeyToUtcNoon(dateRaw: string): Date {
  return new Date(`${dateRaw}T12:00:00.000Z`);
}

function addDays(dateRaw: string, days: number): string {
  const date = dateKeyToUtcNoon(dateRaw);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function diffDaysInclusive(start: string, end: string): number {
  const startMs = dateKeyToUtcNoon(start).getTime();
  const endMs = dateKeyToUtcNoon(end).getTime();
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

function firstDayOfMonth(dateRaw: string): string {
  return `${dateRaw.slice(0, 7)}-01`;
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1, 12));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
}

export function storeDatePresetToRange(
  preset: DatePreset,
  customRange?: { since: string; until: string }
): { since: string; until: string } {
  if (preset === "custom" && customRange) return customRange;

  const today = saoPauloDateKey(new Date());
  switch (preset) {
    case "today":
      return { since: today, until: today };
    case "yesterday": {
      const yesterday = addDays(today, -1);
      return { since: yesterday, until: yesterday };
    }
    case "last_3d":
      return { since: addDays(today, -3), until: today };
    case "last_7d":
      return { since: addDays(today, -7), until: today };
    case "last_14d":
      return { since: addDays(today, -14), until: today };
    case "last_30d":
      return { since: addDays(today, -30), until: today };
    case "last_90d":
      return { since: addDays(today, -90), until: today };
    case "this_month":
      return { since: firstDayOfMonth(today), until: today };
    case "last_month": {
      const year = Number(today.slice(0, 4));
      const month = Number(today.slice(5, 7));
      const prev = shiftMonth(year, month, -1);
      return {
        since: dateKey(prev.year, prev.month, 1),
        until: dateKey(prev.year, prev.month, daysInMonth(prev.year, prev.month)),
      };
    }
    default:
      return { since: addDays(today, -30), until: today };
  }
}

export function storePreviousPeriodDates(
  preset: DatePreset,
  customRange?: { since: string; until: string }
): { since: string; until: string } {
  if (preset === "custom" && customRange) {
    const days = diffDaysInclusive(customRange.since, customRange.until);
    return {
      since: addDays(customRange.since, -days),
      until: addDays(customRange.since, -1),
    };
  }

  const today = saoPauloDateKey(new Date());
  switch (preset) {
    case "today": {
      const yesterday = addDays(today, -1);
      return { since: yesterday, until: yesterday };
    }
    case "yesterday": {
      const beforeYesterday = addDays(today, -2);
      return { since: beforeYesterday, until: beforeYesterday };
    }
    case "last_3d":
      return { since: addDays(today, -6), until: addDays(today, -4) };
    case "last_7d":
      return { since: addDays(today, -14), until: addDays(today, -8) };
    case "last_14d":
      return { since: addDays(today, -28), until: addDays(today, -15) };
    case "last_30d":
      return { since: addDays(today, -60), until: addDays(today, -31) };
    case "last_90d":
      return { since: addDays(today, -180), until: addDays(today, -91) };
    case "this_month": {
      const year = Number(today.slice(0, 4));
      const month = Number(today.slice(5, 7));
      const prev = shiftMonth(year, month, -1);
      return {
        since: dateKey(prev.year, prev.month, 1),
        until: dateKey(prev.year, prev.month, daysInMonth(prev.year, prev.month)),
      };
    }
    case "last_month": {
      const year = Number(today.slice(0, 4));
      const month = Number(today.slice(5, 7));
      const prevPrev = shiftMonth(year, month, -2);
      return {
        since: dateKey(prevPrev.year, prevPrev.month, 1),
        until: dateKey(prevPrev.year, prevPrev.month, daysInMonth(prevPrev.year, prevPrev.month)),
      };
    }
    default:
      return { since: addDays(today, -60), until: addDays(today, -31) };
  }
}

function localDayStartIso(dateRaw: string): string {
  return new Date(`${dateRaw}T00:00:00.000-03:00`).toISOString();
}

function localDayEndIso(dateRaw: string): string {
  return new Date(`${dateRaw}T23:59:59.999-03:00`).toISOString();
}

function itemQuantity(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    if (!item || typeof item !== "object") return sum;
    return sum + toNumber((item as { quantity?: unknown }).quantity);
  }, 0);
}

export async function getCrmSalesDailyReport(args: {
  workspaceId: string;
  startDate: string;
  endDate: string;
}): Promise<VndaReport | null> {
  if (!args.workspaceId || !args.startDate || !args.endDate) return null;

  const admin = createAdminClient();
  const all: CrmSaleRow[] = [];
  const startIso = localDayStartIso(args.startDate);
  const endIso = localDayEndIso(args.endDate);

  let offset = 0;
  while (offset < HARD_CAP) {
    const { data, error } = await admin
      .from("crm_vendas")
      .select("valor, data_compra, shipping_price, discount_price, items")
      .eq("workspace_id", args.workspaceId)
      .gte("data_compra", startIso)
      .lte("data_compra", endIso)
      .order("data_compra", { ascending: true })
      .range(offset, offset + CHUNK - 1);

    if (error) {
      throw new Error(`crm_vendas revenue load failed: ${error.message}`);
    }

    const rows = (data || []) as CrmSaleRow[];
    all.push(...rows);
    if (rows.length < CHUNK) break;
    offset += CHUNK;
  }

  const dailyMap = new Map<string, {
    orders: number;
    revenue: number;
    subtotal: number;
    discount: number;
    shipping: number;
    productsSold: number;
  }>();

  const totals: VndaTotals = {
    orders: 0,
    revenue: 0,
    subtotal: 0,
    discount: 0,
    shipping: 0,
    avgTicket: 0,
    productsSold: 0,
  };

  for (const row of all) {
    if (!row.data_compra) continue;
    const revenue = toNumber(row.valor);
    if (revenue <= 0) continue;

    const dateRaw = saoPauloDateKey(row.data_compra);
    const shipping = toNumber(row.shipping_price);
    const discount = toNumber(row.discount_price);
    const productsSold = itemQuantity(row.items);
    const subtotal = Math.max(0, revenue - shipping + discount);

    const existing = dailyMap.get(dateRaw) || {
      orders: 0,
      revenue: 0,
      subtotal: 0,
      discount: 0,
      shipping: 0,
      productsSold: 0,
    };

    existing.orders += 1;
    existing.revenue += revenue;
    existing.subtotal += subtotal;
    existing.discount += discount;
    existing.shipping += shipping;
    existing.productsSold += productsSold;
    dailyMap.set(dateRaw, existing);

    totals.orders += 1;
    totals.revenue += revenue;
    totals.subtotal += subtotal;
    totals.discount += discount;
    totals.shipping += shipping;
    totals.productsSold += productsSold;
  }

  if (totals.orders === 0) return null;

  totals.revenue = Number(totals.revenue.toFixed(2));
  totals.subtotal = Number(totals.subtotal.toFixed(2));
  totals.discount = Number(totals.discount.toFixed(2));
  totals.shipping = Number(totals.shipping.toFixed(2));
  totals.avgTicket = totals.orders > 0 ? Number((totals.revenue / totals.orders).toFixed(2)) : 0;

  const insights = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateRaw, day]) => ({
      date: dateToDisplay(dateRaw),
      dateRaw,
      orders: day.orders,
      revenue: Number(day.revenue.toFixed(2)),
      subtotal: Number(day.subtotal.toFixed(2)),
      discount: Number(day.discount.toFixed(2)),
      shipping: Number(day.shipping.toFixed(2)),
      avgTicket: day.orders > 0 ? Number((day.revenue / day.orders).toFixed(2)) : 0,
      productsSold: day.productsSold,
    }));

  return { insights, totals };
}
