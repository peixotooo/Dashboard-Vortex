import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { datePresetToTimeRange, getPreviousPeriodDates } from "@/lib/utils";
import type { DatePreset } from "@/lib/types";
import { getVndaConfig, getVndaStockByReferences } from "@/lib/vnda-api";

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
  stock: number | null;
  stockAvailable: boolean | null;
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
  debug: {} as Record<string, unknown>,
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

function getParentSku(sku: string): string {
  const trimmed = sku.trim();
  if (!trimmed) return trimmed;
  const idx = trimmed.lastIndexOf("-");
  if (idx <= 0) return trimmed;
  const suffix = trimmed.slice(idx + 1);
  if (suffix.length === 0 || suffix.length > 6) return trimmed;
  return trimmed.slice(0, idx);
}

function getParentName(name: string): string {
  return name
    .replace(/\s*[-/|]\s*(P|M|G|GG|XGG|XS|S|L|XL|XXL|UN|U)$/i, "")
    .replace(/\s*\((P|M|G|GG|XGG|XS|S|L|XL|XXL|UN|U)\)\s*$/i, "")
    .trim();
}

function rangeToDates(since: string, until: string) {
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

    // Helper: paginated fetch in chunks of 1000 to bypass PostgREST default cap.
    async function fetchAllInWindow(
      startISO: string,
      endISO: string,
      cols: string
    ): Promise<VendaRow[]> {
      const all: VendaRow[] = [];
      const CHUNK = 1000;
      const HARD_CAP = 50000;
      let offset = 0;
      while (offset < HARD_CAP) {
        const { data, error } = await admin
          .from("crm_vendas")
          .select(cols)
          .eq("workspace_id", workspaceId)
          .gte("data_compra", startISO)
          .lte("data_compra", endISO)
          .order("data_compra", { ascending: false })
          .range(offset, offset + CHUNK - 1);
        if (error) {
          console.error("[CRM Overview Summary] page error:", error.message);
          break;
        }
        const rows = (data || []) as unknown as VendaRow[];
        all.push(...rows);
        if (rows.length < CHUNK) break;
        offset += CHUNK;
      }
      return all;
    }

    // Current window: need items, valor, cpf, email
    const curOrders = await fetchAllInWindow(
      cur.start.toISOString(),
      cur.end.toISOString(),
      "cpf, email, cliente, valor, data_compra, items"
    );

    // Previous window: only identifiers needed (for new/returning split)
    const prevOrders = await fetchAllInWindow(
      prevR.start.toISOString(),
      prevR.end.toISOString(),
      "cpf, email, cliente, valor, data_compra, items"
    );

    if (curOrders.length === 0 && prevOrders.length === 0) {
      return NextResponse.json(
        {
          ...EMPTY,
          configured: true,
          period,
          debug: {
            curStart: cur.start.toISOString(),
            curEnd: cur.end.toISOString(),
            prevStart: prevR.start.toISOString(),
            prevEnd: prevR.end.toISOString(),
            curOrders: 0,
            prevOrders: 0,
            workspaceId,
          },
        },
        { headers: { "Cache-Control": "private, max-age=60" } }
      );
    }

    // --- Top products consolidated by parent SKU ---
    const productMap = new Map<string, ProductAgg>();
    const allVariantsByParent = new Map<string, Set<string>>();
    for (const order of curOrders) {
      const items = Array.isArray(order.items) ? order.items : [];
      const seenInOrder = new Set<string>();
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
        } else {
          productMap.set(key, {
            parentSku: parentSku || "—",
            name: parentName,
            quantity: qty,
            revenue: total,
            orders: 1,
            variants: 0,
            stock: null,
            stockAvailable: null,
          });
        }
        seenInOrder.add(key);

        if (rawSku && parentSku) {
          const set = allVariantsByParent.get(parentSku) ?? new Set<string>();
          set.add(rawSku);
          allVariantsByParent.set(parentSku, set);
        }
      }
    }
    for (const [key, agg] of productMap) {
      if (agg.parentSku !== "—") {
        const set = allVariantsByParent.get(agg.parentSku);
        if (set) agg.variants = set.size;
      }
      productMap.set(key, agg);
    }

    const topProducts = [...productMap.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // Fetch live stock from VNDA for the top 5 parent SKUs (parallel, best-effort).
    try {
      const vndaConfig = await getVndaConfig(workspaceId);
      if (vndaConfig) {
        const refs = topProducts
          .map((p) => p.parentSku)
          .filter((s) => s && s !== "—");
        if (refs.length > 0) {
          const stockMap = await getVndaStockByReferences(vndaConfig, refs);
          for (const p of topProducts) {
            const s = stockMap.get(p.parentSku);
            if (s) {
              p.stock = s.stock;
              p.stockAvailable = s.available;
            }
          }
        }
      }
    } catch (stockErr) {
      console.warn(
        "[CRM Overview Summary] stock lookup failed:",
        stockErr instanceof Error ? stockErr.message : stockErr
      );
    }

    // --- New vs returning customers ---
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

      // Look up first-ever order date per customer, paginating to bypass the cap.
      async function lookupFirstSeen(field: "cpf" | "email", values: string[]) {
        const CHUNK = 1000;
        // Process IN-list in chunks of 200 to keep URL size sane.
        const VALUES_CHUNK = 200;
        for (let i = 0; i < values.length; i += VALUES_CHUNK) {
          const slice = values.slice(i, i + VALUES_CHUNK);
          let offset = 0;
          while (true) {
            const { data, error } = await admin
              .from("crm_vendas")
              .select(`${field}, data_compra`)
              .eq("workspace_id", workspaceId)
              .in(field, slice)
              .order("data_compra", { ascending: true })
              .range(offset, offset + CHUNK - 1);
            if (error) {
              console.error("[CRM Overview Summary] firstSeen error:", error.message);
              break;
            }
            const rows = (data || []) as Array<Record<string, string | null>>;
            for (const r of rows) {
              const v = r[field];
              if (!v) continue;
              const k = field === "cpf" ? `cpf:${v}` : `email:${v.toLowerCase()}`;
              if (!firstSeen.has(k)) firstSeen.set(k, r.data_compra as string);
            }
            if (rows.length < CHUNK) break;
            offset += CHUNK;
          }
        }
      }

      if (cpfs.length > 0) await lookupFirstSeen("cpf", cpfs);
      if (emails.length > 0) await lookupFirstSeen("email", emails);
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
        debug: {
          curStart: cur.start.toISOString(),
          curEnd: cur.end.toISOString(),
          prevStart: prevR.start.toISOString(),
          prevEnd: prevR.end.toISOString(),
          curOrders: curOrders.length,
          prevOrders: prevOrders.length,
          uniqueCur: customersInCur.size,
          uniquePrev: customersInPrev.size,
        },
      },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CRM Overview Summary] Error:", message);
    return NextResponse.json({ ...EMPTY, error: message }, { status: 500 });
  }
}
