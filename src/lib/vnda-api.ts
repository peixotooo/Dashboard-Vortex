import { decrypt } from "@/lib/encryption";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// --- Types ---

export interface VndaConfig {
  apiToken: string;
  storeHost: string;
}

export interface VndaOrder {
  id: number;
  code: string;
  status: string;
  total: number;
  subtotal: number;
  discount_price: number;
  shipping_price: number;
  payment_method: string;
  channel: string;
  confirmed_at: string | null;
  received_at: string | null;
  canceled_at: string | null;
  items: VndaOrderItem[];
}

export interface VndaOrderItem {
  id: number;
  product_name: string;
  variant_name: string;
  sku: string;
  quantity: number;
  price: number;
  total: number;
}

export interface VndaDailyRow {
  date: string; // DD/MM
  dateRaw: string; // YYYY-MM-DD
  orders: number;
  revenue: number;
  subtotal: number;
  discount: number;
  shipping: number;
  avgTicket: number;
  productsSold: number;
}

export interface VndaTotals {
  orders: number;
  revenue: number;
  subtotal: number;
  discount: number;
  shipping: number;
  avgTicket: number;
  productsSold: number;
}

export interface VndaReport {
  insights: VndaDailyRow[];
  totals: VndaTotals;
}

export interface VndaProductRow {
  name: string;
  quantity: number;
  revenue: number;
  avgPrice: number;
  percentOfTotal: number;
}

export interface VndaSearchProduct {
  id: number;
  active: boolean;
  available: boolean;
  slug: string;
  reference: string;
  name: string;
  description: string;
  image_url: string;
  url: string;
  price: number;
  on_sale: boolean;
  sale_price: number | null;
  tags: Array<{ name: string; type: string }>;
}

// --- Date helpers ---

function datePresetToRange(preset: string): { start: string; end: string } {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const sub = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - days);
    return d;
  };

  switch (preset) {
    case "today":
      return { start: fmt(today), end: fmt(today) };
    case "yesterday": {
      const y = sub(1);
      return { start: fmt(y), end: fmt(y) };
    }
    case "last_7d":
      return { start: fmt(sub(7)), end: fmt(today) };
    case "last_14d":
      return { start: fmt(sub(14)), end: fmt(today) };
    case "last_30d":
      return { start: fmt(sub(30)), end: fmt(today) };
    case "last_90d":
      return { start: fmt(sub(90)), end: fmt(today) };
    case "this_month": {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: fmt(firstDay), end: fmt(today) };
    }
    case "last_month": {
      const firstDay = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start: fmt(firstDay), end: fmt(lastDay) };
    }
    default:
      return { start: fmt(sub(30)), end: fmt(today) };
  }
}

// Convert YYYY-MM-DD to DD/MM
function formatDateBR(dateStr: string): string {
  const parts = dateStr.slice(0, 10).split("-");
  return `${parts[2]}/${parts[1]}`;
}

// --- Get config from database ---

export async function getVndaConfig(workspaceId?: string): Promise<VndaConfig | null> {
  // Try database first
  if (workspaceId) {
    try {
      const cookieStore = await cookies();
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return cookieStore.getAll();
            },
            setAll() {},
          },
        }
      );

      const { data } = await supabase
        .from("vnda_connections")
        .select("api_token, store_host")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (data?.api_token && data?.store_host) {
        return {
          apiToken: decrypt(data.api_token),
          storeHost: data.store_host,
        };
      }
    } catch {
      // Fall through to env vars
    }
  }

  // Fallback to env vars
  const token = process.env.VNDA_API_TOKEN;
  const host = process.env.VNDA_STORE_HOST;
  if (token && host) {
    return { apiToken: token, storeHost: host };
  }

  return null;
}

// --- API request ---

async function vndaRequest<T>(
  path: string,
  config: VndaConfig,
  params?: Record<string, string>
): Promise<{ data: T; pagination?: { total_pages: number; current_page: number; next_page: number | null; total_count: number } }> {
  const url = new URL(`https://api.vnda.com.br/api/v2/${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      Accept: "application/json",
      "X-Shop-Host": config.storeHost,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`VNDA API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();

  // Parse pagination from header
  const paginationHeader = res.headers.get("X-Pagination");
  let pagination;
  if (paginationHeader) {
    try {
      pagination = JSON.parse(paginationHeader);
    } catch {
      // Ignore parse errors
    }
  }

  return { data, pagination };
}

// --- Fetch all orders with automatic pagination ---

export async function getVndaOrders(args: {
  config: VndaConfig;
  datePreset?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
}): Promise<VndaOrder[]> {
  const range = args.startDate && args.endDate
    ? { start: args.startDate, end: args.endDate }
    : datePresetToRange(args.datePreset || "last_30d");

  const allOrders: VndaOrder[] = [];
  let page = 1;
  const maxPages = 500; // Safety limit

  while (page <= maxPages) {
    const { data, pagination } = await vndaRequest<VndaOrder[]>("orders", args.config, {
      status: args.status || "confirmed",
      start: range.start,
      finish: range.end,
      page: String(page),
      per_page: "200",
    });

    allOrders.push(...(data || []));

    if (!pagination?.next_page || page >= (pagination?.total_pages || 1)) {
      break;
    }
    page++;
  }

  return allOrders;
}

// --- Aggregate orders by day ---

export async function getVndaDailyReport(args: {
  config: VndaConfig;
  datePreset?: string;
  startDate?: string;
  endDate?: string;
}): Promise<VndaReport> {
  const orders = await getVndaOrders({
    config: args.config,
    datePreset: args.datePreset,
    startDate: args.startDate,
    endDate: args.endDate,
    status: "confirmed",
  });

  // Group by confirmed_at date
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

  for (const order of orders) {
    const dateStr = (order.confirmed_at || order.received_at || "").slice(0, 10);
    if (!dateStr) continue;

    const existing = dailyMap.get(dateStr) || {
      orders: 0, revenue: 0, subtotal: 0, discount: 0, shipping: 0, productsSold: 0,
    };

    const itemCount = (order.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0);

    existing.orders += 1;
    existing.revenue += order.total || 0;
    existing.subtotal += order.subtotal || 0;
    existing.discount += order.discount_price || 0;
    existing.shipping += order.shipping_price || 0;
    existing.productsSold += itemCount;

    dailyMap.set(dateStr, existing);

    totals.orders += 1;
    totals.revenue += order.total || 0;
    totals.subtotal += order.subtotal || 0;
    totals.discount += order.discount_price || 0;
    totals.shipping += order.shipping_price || 0;
    totals.productsSold += itemCount;
  }

  totals.avgTicket = totals.orders > 0 ? totals.revenue / totals.orders : 0;

  // Convert to sorted array
  const insights: VndaDailyRow[] = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateRaw, day]) => ({
      date: formatDateBR(dateRaw),
      dateRaw,
      orders: day.orders,
      revenue: parseFloat(day.revenue.toFixed(2)),
      subtotal: parseFloat(day.subtotal.toFixed(2)),
      discount: parseFloat(day.discount.toFixed(2)),
      shipping: parseFloat(day.shipping.toFixed(2)),
      avgTicket: day.orders > 0 ? parseFloat((day.revenue / day.orders).toFixed(2)) : 0,
      productsSold: day.productsSold,
    }));

  return { insights, totals };
}

// --- Aggregate products ---

export async function getVndaProductReport(args: {
  config: VndaConfig;
  datePreset?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}): Promise<VndaProductRow[]> {
  const orders = await getVndaOrders({
    config: args.config,
    datePreset: args.datePreset,
    startDate: args.startDate,
    endDate: args.endDate,
    status: "confirmed",
  });

  // Aggregate by product_name
  const productMap = new Map<string, { quantity: number; revenue: number }>();

  for (const order of orders) {
    for (const item of order.items || []) {
      const name = item.product_name || "(sem nome)";
      const existing = productMap.get(name) || { quantity: 0, revenue: 0 };
      existing.quantity += item.quantity || 0;
      existing.revenue += item.total || 0;
      productMap.set(name, existing);
    }
  }

  const totalRevenue = [...productMap.values()].reduce((sum, p) => sum + p.revenue, 0);

  const products: VndaProductRow[] = [...productMap.entries()]
    .map(([name, data]) => ({
      name,
      quantity: data.quantity,
      revenue: parseFloat(data.revenue.toFixed(2)),
      avgPrice: data.quantity > 0 ? parseFloat((data.revenue / data.quantity).toFixed(2)) : 0,
      percentOfTotal: totalRevenue > 0 ? parseFloat(((data.revenue / totalRevenue) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, args.limit || 20);

  return products;
}

// --- Search products ---

export async function searchVndaProducts(
  config: VndaConfig,
  params: Record<string, string> = {}
): Promise<VndaSearchProduct[]> {
  const { data } = await vndaRequest<unknown>("products/search", config, params);
  // VNDA search endpoint may return array or wrapper object { results: [...] }
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.results)) return obj.results;
    if (Array.isArray(obj.products)) return obj.products;
  }
  return [];
}

// --- List products (plain endpoint, always returns array) ---

export async function listVndaProducts(
  config: VndaConfig,
  params: Record<string, string> = {}
): Promise<VndaSearchProduct[]> {
  const { data } = await vndaRequest<VndaSearchProduct[]>("products", config, params);
  return data || [];
}

// --- Health check ---

export async function testVndaConnection(config: VndaConfig): Promise<{ ok: boolean; message: string; orderCount?: number }> {
  try {
    const { data, pagination } = await vndaRequest<VndaOrder[]>("orders", config, {
      per_page: "1",
      page: "1",
    });

    return {
      ok: true,
      message: `Conexão OK. ${pagination?.total_count || data?.length || 0} pedidos encontrados.`,
      orderCount: pagination?.total_count || 0,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Erro ao conectar com VNDA",
    };
  }
}
