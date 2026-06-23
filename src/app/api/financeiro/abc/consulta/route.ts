// GET /api/financeiro/abc/consulta
//
// Stable read endpoint for the ABC curve. It intentionally does not return
// order-level rows, because ABC includes revenue and profitability signals.
//
// Auth modes:
//   1. Dashboard session + x-workspace-id header.
//   2. Server-to-server token:
//      Authorization: Bearer <FINANCEIRO_ABC_API_TOKEN>
//      or x-abc-api-token: <FINANCEIRO_ABC_API_TOKEN>
//      plus workspace_id query/header.
//
// Query:
//   period_days=7|14|30|60|90 controls the analyzed period. If the saved
//   snapshot is from a different period, this endpoint refreshes it first.

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AuthError, getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import type { CrmVendaRow } from "@/lib/crm-rfm";
import {
  ABC_ALLOWED_PERIODS,
  ABC_PERIOD_DAYS_DEFAULT,
  recomputeAbcSnapshot,
} from "@/lib/financeiro/recompute";
import { createAdminClient } from "@/lib/supabase-admin";

export const maxDuration = 300;

type AbcClass = "A" | "B" | "C";
type SortKey =
  | "revenue_desc"
  | "revenue_asc"
  | "qty_desc"
  | "profit_desc"
  | "margin_desc"
  | "turnover_desc"
  | "coverage_asc"
  | "cumulative_asc"
  | "name_asc";

interface SnapshotRow {
  summary: Record<string, unknown> | null;
  products: RawProductRow[] | null;
  period_days: number | null;
  row_count: number | null;
  computed_at: string | null;
}

interface RawProductRow {
  sku?: unknown;
  product_id?: unknown;
  name?: unknown;
  qty_sold?: unknown;
  units_per_day?: unknown;
  stock_units?: unknown;
  stock_coverage_days?: unknown;
  turnover_period?: unknown;
  stock_source?: unknown;
  revenue?: unknown;
  cost_unit?: unknown;
  cost_total?: unknown;
  profit?: unknown;
  margin_pct?: unknown;
  abc_class?: unknown;
  cumulative_revenue_pct?: unknown;
  cost_source?: unknown;
}

interface AbcItem {
  rank: number;
  sku: string | null;
  product_id: string | null;
  name: string;
  qty_sold: number;
  units_per_day: number;
  stock_units: number | null;
  stock_coverage_days: number | null;
  turnover_period: number | null;
  stock_source: "hub_products" | "pricing_history" | "none";
  revenue: number;
  revenue_pct: number;
  cost_unit: number;
  cost_total: number;
  profit: number;
  margin_pct: number;
  abc_class: AbcClass;
  cumulative_revenue_pct: number;
  cost_source: "tracked" | "estimated";
}

const CACHE_HEADERS = { "Cache-Control": "private, max-age=60" };
const VALID_ABC_CLASSES = new Set(["A", "B", "C"]);
const VALID_SORTS = new Set<SortKey>([
  "revenue_desc",
  "revenue_asc",
  "qty_desc",
  "profit_desc",
  "margin_desc",
  "turnover_desc",
  "coverage_asc",
  "cumulative_asc",
  "name_asc",
]);
const PAGE_SIZE = 1000;

function serverTokens(): string[] {
  return [
    process.env.FINANCEIRO_ABC_API_TOKEN,
    process.env.ABC_API_TOKEN,
  ]
    .map((token) => token?.trim())
    .filter((token): token is string => Boolean(token));
}

function safeTokenEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function bearerToken(request: NextRequest): string | null {
  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return null;
}

function requestToken(request: NextRequest): string | null {
  return request.headers.get("x-abc-api-token")?.trim() || bearerToken(request);
}

function workspaceFromRequest(request: NextRequest): string {
  return (
    request.headers.get("x-workspace-id") ||
    request.nextUrl.searchParams.get("workspace_id") ||
    ""
  ).trim();
}

async function resolveWorkspaceId(
  request: NextRequest
): Promise<{ workspaceId: string; authMode: "session" | "token" }> {
  const token = requestToken(request);
  if (token) {
    const configured = serverTokens();
    if (configured.length === 0) {
      throw new AuthError("ABC API token is not configured", 503);
    }
    const valid = configured.some((expected) => safeTokenEquals(token, expected));
    if (!valid) throw new AuthError("Invalid ABC API token", 401);

    const workspaceId = workspaceFromRequest(request);
    if (!workspaceId) throw new AuthError("Workspace not specified", 400);
    return { workspaceId, authMode: "token" };
  }

  const auth = await getWorkspaceContext(request);
  return { workspaceId: auth.workspaceId, authMode: "session" };
}

function numberParam(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePeriodDays(value: string | null): number {
  if (value == null || value.trim() === "") return ABC_PERIOD_DAYS_DEFAULT;
  const parsed = Number.parseInt(value, 10);
  if ((ABC_ALLOWED_PERIODS as readonly number[]).includes(parsed)) return parsed;
  throw new AuthError(
    `Invalid period_days. Use one of: ${ABC_ALLOWED_PERIODS.join(", ")}`,
    400
  );
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  const str = String(value).trim();
  return str || null;
}

function asNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function asNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asAbcClass(value: unknown): AbcClass {
  const cls = String(value ?? "").toUpperCase();
  return VALID_ABC_CLASSES.has(cls) ? (cls as AbcClass) : "C";
}

function asCostSource(value: unknown): "tracked" | "estimated" {
  return value === "tracked" ? "tracked" : "estimated";
}

function asStockSource(value: unknown): "hub_products" | "pricing_history" | "none" {
  return value === "hub_products" || value === "pricing_history" ? value : "none";
}

function normalizeItem(
  row: RawProductRow,
  index: number,
  totalRevenue: number
): AbcItem {
  const revenue = asNumber(row.revenue);
  return {
    rank: index + 1,
    sku: asString(row.sku),
    product_id: asString(row.product_id),
    name: asString(row.name) ?? "(sem nome)",
    qty_sold: asNumber(row.qty_sold),
    units_per_day: asNumber(row.units_per_day),
    stock_units: asNullableNumber(row.stock_units),
    stock_coverage_days: asNullableNumber(row.stock_coverage_days),
    turnover_period: asNullableNumber(row.turnover_period),
    stock_source: asStockSource(row.stock_source),
    revenue,
    revenue_pct: totalRevenue > 0 ? round4(revenue / totalRevenue) : 0,
    cost_unit: asNumber(row.cost_unit),
    cost_total: asNumber(row.cost_total),
    profit: asNumber(row.profit),
    margin_pct: asNumber(row.margin_pct),
    abc_class: asAbcClass(row.abc_class),
    cumulative_revenue_pct: asNumber(row.cumulative_revenue_pct),
    cost_source: asCostSource(row.cost_source),
  };
}

function sortItems(items: AbcItem[], sort: SortKey): AbcItem[] {
  const sorted = items.slice();
  const byName = (a: AbcItem, b: AbcItem) => a.name.localeCompare(b.name, "pt-BR");

  if (sort === "revenue_asc") sorted.sort((a, b) => a.revenue - b.revenue);
  else if (sort === "qty_desc") sorted.sort((a, b) => b.qty_sold - a.qty_sold);
  else if (sort === "profit_desc") sorted.sort((a, b) => b.profit - a.profit);
  else if (sort === "margin_desc") sorted.sort((a, b) => b.margin_pct - a.margin_pct);
  else if (sort === "turnover_desc")
    sorted.sort((a, b) => (b.turnover_period ?? -1) - (a.turnover_period ?? -1));
  else if (sort === "coverage_asc")
    sorted.sort(
      (a, b) =>
        (a.stock_coverage_days ?? Number.POSITIVE_INFINITY) -
        (b.stock_coverage_days ?? Number.POSITIVE_INFINITY)
    );
  else if (sort === "cumulative_asc")
    sorted.sort((a, b) => a.cumulative_revenue_pct - b.cumulative_revenue_pct);
  else if (sort === "name_asc") sorted.sort(byName);
  else sorted.sort((a, b) => b.revenue - a.revenue);

  return sorted;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

async function loadSnapshot(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
): Promise<SnapshotRow | null> {
  const { data, error } = await admin
    .from("crm_abc_snapshots")
    .select("summary, products, period_days, row_count, computed_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle<SnapshotRow>();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function loadCrmRows(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  periodDays: number
): Promise<CrmVendaRow[]> {
  const cutoff = new Date(
    Date.now() - periodDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const rows: CrmVendaRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from("crm_vendas")
      .select(
        "cliente, email, telefone, valor, data_compra, cupom, numero_pedido, compras_anteriores, items, payment_method, installments, shipping_price, discount_price, source_order_id"
      )
      .eq("workspace_id", workspaceId)
      .gte("data_compra", cutoff)
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    if (!data?.length) break;

    rows.push(...(data as CrmVendaRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function ensureSnapshotForPeriod(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  periodDays: number
): Promise<{ snapshot: SnapshotRow | null; recomputed: boolean }> {
  const current = await loadSnapshot(admin, workspaceId);
  if (current?.period_days === periodDays && snapshotHasTurnoverFields(current)) {
    return { snapshot: current, recomputed: false };
  }

  const rows = await loadCrmRows(admin, workspaceId, periodDays);
  await recomputeAbcSnapshot(admin, workspaceId, rows, periodDays);
  return { snapshot: await loadSnapshot(admin, workspaceId), recomputed: true };
}

function snapshotHasTurnoverFields(snapshot: SnapshotRow): boolean {
  const products = snapshot.products ?? [];
  if (products.length === 0) return true;
  return products.every(
    (product) =>
      Object.prototype.hasOwnProperty.call(product, "units_per_day") &&
      Object.prototype.hasOwnProperty.call(product, "stock_units") &&
      Object.prototype.hasOwnProperty.call(product, "turnover_period")
  );
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId, authMode } = await resolveWorkspaceId(request);
    const searchParams = request.nextUrl.searchParams;

    const abcClassRaw = searchParams.get("abc_class")?.trim().toUpperCase() ?? "";
    const abcClass = VALID_ABC_CLASSES.has(abcClassRaw)
      ? (abcClassRaw as AbcClass)
      : null;
    const q = searchParams.get("q")?.trim().toLowerCase() ?? "";
    const sku = searchParams.get("sku")?.trim().toLowerCase() ?? "";
    const productId = searchParams.get("product_id")?.trim().toLowerCase() ?? "";
    const sortRaw = searchParams.get("sort") as SortKey | null;
    const sort: SortKey = sortRaw && VALID_SORTS.has(sortRaw) ? sortRaw : "revenue_desc";
    const limit = Math.min(1000, Math.max(1, numberParam(searchParams.get("limit"), 100)));
    const offset = Math.max(0, numberParam(searchParams.get("offset"), 0));
    const periodDays = parsePeriodDays(
      searchParams.get("period_days") ?? searchParams.get("periodo_dias")
    );

    const admin = createAdminClient();
    const { snapshot: data, recomputed } = await ensureSnapshotForPeriod(
      admin,
      workspaceId,
      periodDays
    );

    if (!data) {
      return NextResponse.json(
        {
          ok: true,
          summary: null,
          items: [],
          pagination: { total: 0, offset, limit, has_more: false },
          snapshot: null,
          requested_period_days: periodDays,
          message:
            "Snapshot ABC ainda nao computado. Gere pela tela Financeiro > Curva ABC ou pelo endpoint de recompute.",
        },
        { headers: CACHE_HEADERS }
      );
    }

    const rawProducts = data.products ?? [];
    const summaryRevenue = asNumber(data.summary?.total_revenue);
    const totalRevenue =
      summaryRevenue > 0
        ? summaryRevenue
        : rawProducts.reduce((sum, product) => sum + asNumber(product.revenue), 0);

    let items = rawProducts.map((product, index) =>
      normalizeItem(product, index, totalRevenue)
    );

    if (abcClass) items = items.filter((item) => item.abc_class === abcClass);
    if (sku) items = items.filter((item) => item.sku?.toLowerCase() === sku);
    if (productId) {
      items = items.filter((item) => item.product_id?.toLowerCase() === productId);
    }
    if (q) {
      items = items.filter((item) =>
        [item.name, item.sku, item.product_id]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q))
      );
    }

    items = sortItems(items, sort);

    const total = items.length;
    const paginated = items.slice(offset, offset + limit);

    return NextResponse.json(
      {
        ok: true,
        auth_mode: authMode,
        summary: data.summary ?? {},
        items: paginated,
        pagination: {
          total,
          offset,
          limit,
          has_more: offset + paginated.length < total,
        },
        filters: {
          abc_class: abcClass,
          q: q || null,
          sku: sku || null,
          product_id: productId || null,
          sort,
          period_days: periodDays,
        },
        snapshot: {
          period_days: data.period_days,
          row_count: data.row_count,
          computed_at: data.computed_at,
          recomputed,
        },
      },
      { headers: CACHE_HEADERS }
    );
  } catch (error) {
    return handleAuthError(error);
  }
}
