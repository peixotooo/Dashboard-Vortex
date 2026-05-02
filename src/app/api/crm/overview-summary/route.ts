import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { datePresetToTimeRange, getPreviousPeriodDates } from "@/lib/utils";
import type { DatePreset } from "@/lib/types";

export const maxDuration = 15;

interface VendaRow {
  cpf: string | null;
  email: string | null;
  cliente: string | null;
  valor: number | null;
  data_compra: string;
  items: Array<{
    name?: string;
    sku?: string;
    quantity?: number;
    price?: number;
    total?: number;
  }> | null;
}

interface ProductAgg {
  parentSku: string;
  name: string;
  quantity: number;
  revenue: number;
  orders: number;
  variants: number;
}

const EMPTY = {
  configured: false,
  topProducts: [] as ProductAgg[],
  customers: {
    new: 0,
    returning: 0,
    prevNew: 0,
    prevReturning: 0,
  },
  totals: { orders: 0, revenue: 0 },
  period: { since: "", until: "" },
};

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    }
  );
}

function customerKey(row: Pick<VendaRow, "cpf" | "email">): string | null {
  if (row.cpf && row.cpf.trim()) return `cpf:${row.cpf.trim()}`;
  if (row.email && row.email.trim()) return `email:${row.email.trim().toLowerCase()}`;
  return null;
}

// Strip trailing variant suffix from SKU. Patterns:
//   "256392895-3" → "256392895"
//   "ABC-123-S"   → "ABC-123"
//   "ABC123"      → "ABC123" (no change)
// Heuristic: drop the last "-..." segment if the suffix is short (<=6 chars).
function getParentSku(sku: string): string {
  const trimmed = sku.trim();
  if (!trimmed) return trimmed;
  const idx = trimmed.lastIndexOf("-");
  if (idx <= 0) return trimmed;
  const suffix = trimmed.slice(idx + 1);
  if (suffix.length === 0 || suffix.length > 6) return trimmed;
  return trimmed.slice(0, idx);
}

// Strip trailing size/color tokens from product names so variants collapse.
//   "CAMISETA OVERSIZED TRUE CLUB BEGE - P"  → "CAMISETA OVERSIZED TRUE CLUB BEGE"
//   "CAMISETA OVERSIZED TRUE CLUB BEGE / GG" → "CAMISETA OVERSIZED TRUE CLUB BEGE"
function getParentName(name: string): string {
  return name
    .replace(/\s*[-/|]\s*(P|M|G|GG|XGG|XS|S|L|XL|XXL|UN|U)$/i, "")
    .replace(/\s*\((P|M|G|GG|XGG|XS|S|L|XL|XXL|UN|U)\)\s*$/i, "")
    .trim();
}

function rangeToDates(since: string, until: string) {
  // Treat dates as full-day windows in local timezone, but use ISO range for query.
  const start = new Date(`${since}T00:00:00.000Z`);
  const end = new Date(`${until}T23:59:59.999Z`);
  return { start, end };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const datePreset = (searchParams.get("date_preset") || "last_30d") as DatePreset;
    const sinceParam = searchParams.get("since") || "";
    const untilParam = searchParams.get("until") || "";
    const customRange = sinceParam && untilParam ? { since: sinceParam, until: untilParam } : undefined;

    const period = customRange ?? datePresetToTimeRange(datePreset, customRange);
    const prev = getPreviousPeriodDates(datePreset, customRange);

    const cur = rangeToDates(period.since, period.until);
    const prevR = rangeToDates(prev.since, prev.until);

    const admin = createAdminClient();

    // Fetch all orders for [prev.start, cur.end]
    const { data: recentOrders, error: recentErr } = await admin
      .from("crm_vendas")
      .select("cpf, email, cliente, valor, data_compra, items")
      .eq("workspace_id", workspaceId)
      .gte("data_compra", prevR.start.toISOString())
      .lte("data_compra", cur.end.toISOString())
      .order("data_compra", { ascending: true });

    if (recentErr) {
      console.error("[CRM Overview Summary] Recent orders error:", recentErr.message);
      return NextResponse.json({ ...EMPTY, period });
    }

    const orders = (recentOrders || []) as VendaRow[];
    if (orders.length === 0) {
      return NextResponse.json({ ...EMPTY, configured: true, period });
    }

    // Split current vs previous window
    const curOrders: VendaRow[] = [];
    const prevOrders: VendaRow[] = [];
    for (const o of orders) {
      const t = new Date(o.data_compra).getTime();
      if (t >= cur.start.getTime() && t <= cur.end.getTime()) curOrders.push(o);
      else if (t >= prevR.start.getTime() && t <= prevR.end.getTime()) prevOrders.push(o);
    }

    // --- Top products consolidated by parent SKU ---
    const productMap = new Map<string, ProductAgg>();
    for (const order of curOrders) {
      const items = Array.isArray(order.items) ? order.items : [];
      const seenInOrder = new Set<string>();
      const variantsInOrder = new Map<string, Set<string>>();
      for (const it of items) {
        const rawSku = (it.sku || "").trim();
        const rawName = (it.name || rawSku || "Sem nome").trim();
        if (!rawSku && !rawName) continue;

        const parentSku = rawSku ? getParentSku(rawSku) : "";
        const parentName = getParentName(rawName);
        const key = parentSku || parentName;

        const qty = Number(it.quantity) || 0;
        const total = Number(it.total) || (Number(it.price) || 0) * qty;

        const existing = productMap.get(key);
        if (existing) {
          existing.quantity += qty;
          existing.revenue += total;
          if (!seenInOrder.has(key)) existing.orders += 1;
          if (rawSku) {
            const set = variantsInOrder.get(key) ?? new Set<string>();
            set.add(rawSku);
            variantsInOrder.set(key, set);
          }
        } else {
          productMap.set(key, {
            parentSku: parentSku || "—",
            name: parentName,
            quantity: qty,
            revenue: total,
            orders: 1,
            variants: rawSku ? 1 : 0,
          });
          if (rawSku) variantsInOrder.set(key, new Set([rawSku]));
        }
        seenInOrder.add(key);
      }
    }

    // Recompute variant count globally (not just per-order) — track all distinct variant SKUs
    const allVariantsByParent = new Map<string, Set<string>>();
    for (const order of curOrders) {
      const items = Array.isArray(order.items) ? order.items : [];
      for (const it of items) {
        const rawSku = (it.sku || "").trim();
        if (!rawSku) continue;
        const parent = getParentSku(rawSku);
        const set = allVariantsByParent.get(parent) ?? new Set<string>();
        set.add(rawSku);
        allVariantsByParent.set(parent, set);
      }
    }
    for (const [key, agg] of productMap) {
      const set = allVariantsByParent.get(agg.parentSku);
      if (set) agg.variants = set.size;
      productMap.set(key, agg);
    }

    const topProducts = [...productMap.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // --- New vs returning customers (for current and previous periods) ---
    const customersInCur = new Set<string>();
    const customersInPrev = new Set<string>();
    for (const o of curOrders) {
      const k = customerKey(o);
      if (k) customersInCur.add(k);
    }
    for (const o of prevOrders) {
      const k = customerKey(o);
      if (k) customersInPrev.add(k);
    }

    const allKeys = new Set<string>([...customersInCur, ...customersInPrev]);
    const firstSeen = new Map<string, string>();
    if (allKeys.size > 0) {
      const cpfs = [...allKeys]
        .filter((k) => k.startsWith("cpf:"))
        .map((k) => k.slice(4));
      const emails = [...allKeys]
        .filter((k) => k.startsWith("email:"))
        .map((k) => k.slice(6));

      if (cpfs.length > 0) {
        const { data: cpfRows } = await admin
          .from("crm_vendas")
          .select("cpf, data_compra")
          .eq("workspace_id", workspaceId)
          .in("cpf", cpfs)
          .order("data_compra", { ascending: true });
        for (const r of (cpfRows || []) as Array<{ cpf: string | null; data_compra: string }>) {
          if (!r.cpf) continue;
          const k = `cpf:${r.cpf}`;
          if (!firstSeen.has(k)) firstSeen.set(k, r.data_compra);
        }
      }
      if (emails.length > 0) {
        const { data: emailRows } = await admin
          .from("crm_vendas")
          .select("email, data_compra")
          .eq("workspace_id", workspaceId)
          .in("email", emails)
          .order("data_compra", { ascending: true });
        for (const r of (emailRows || []) as Array<{ email: string | null; data_compra: string }>) {
          if (!r.email) continue;
          const k = `email:${r.email.toLowerCase()}`;
          if (!firstSeen.has(k)) firstSeen.set(k, r.data_compra);
        }
      }
    }

    let newCount = 0;
    let returningCount = 0;
    for (const k of customersInCur) {
      const first = firstSeen.get(k);
      if (!first) continue;
      const t = new Date(first).getTime();
      if (t >= cur.start.getTime()) newCount += 1;
      else returningCount += 1;
    }

    let prevNewCount = 0;
    let prevReturningCount = 0;
    for (const k of customersInPrev) {
      const first = firstSeen.get(k);
      if (!first) continue;
      const t = new Date(first).getTime();
      if (t >= prevR.start.getTime() && t <= prevR.end.getTime()) prevNewCount += 1;
      else if (t < prevR.start.getTime()) prevReturningCount += 1;
    }

    const totalRevenue = curOrders.reduce((s, o) => s + (Number(o.valor) || 0), 0);

    return NextResponse.json(
      {
        configured: true,
        topProducts,
        customers: {
          new: newCount,
          returning: returningCount,
          prevNew: prevNewCount,
          prevReturning: prevReturningCount,
        },
        totals: { orders: curOrders.length, revenue: totalRevenue },
        period,
      },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CRM Overview Summary] Error:", message);
    return NextResponse.json({ ...EMPTY, error: message }, { status: 500 });
  }
}
