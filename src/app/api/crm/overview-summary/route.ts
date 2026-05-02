import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";

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

interface ItemAgg {
  sku: string;
  name: string;
  quantity: number;
  revenue: number;
  orders: number;
}

const EMPTY = {
  configured: false,
  topProducts: [] as ItemAgg[],
  customers: {
    new: 0,
    returning: 0,
    prevNew: 0,
    prevReturning: 0,
  },
  totals: { orders: 0, revenue: 0 },
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

    const admin = createAdminClient();

    // Window: last 7 days vs previous 7 days
    const now = new Date();
    const cur7Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prev7Start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Fetch last 14 days of orders for current + previous comparison
    const { data: recentOrders, error: recentErr } = await admin
      .from("crm_vendas")
      .select("cpf, email, cliente, valor, data_compra, items")
      .eq("workspace_id", workspaceId)
      .gte("data_compra", prev7Start.toISOString())
      .order("data_compra", { ascending: true });

    if (recentErr) {
      console.error("[CRM Overview Summary] Recent orders error:", recentErr.message);
      return NextResponse.json(EMPTY);
    }

    const orders = (recentOrders || []) as VendaRow[];
    if (orders.length === 0) {
      return NextResponse.json({ ...EMPTY, configured: true });
    }

    // Split current vs previous window
    const curOrders: VendaRow[] = [];
    const prevOrders: VendaRow[] = [];
    for (const o of orders) {
      const t = new Date(o.data_compra).getTime();
      if (t >= cur7Start.getTime()) curOrders.push(o);
      else prevOrders.push(o);
    }

    // --- Top products (current 7d window only) ---
    const itemMap = new Map<string, ItemAgg>();
    for (const order of curOrders) {
      const items = Array.isArray(order.items) ? order.items : [];
      const seenInOrder = new Set<string>();
      for (const it of items) {
        const sku = (it.sku || "").trim();
        const name = (it.name || sku || "Sem nome").trim();
        if (!sku && !name) continue;
        const key = sku || name;
        const qty = Number(it.quantity) || 0;
        const total = Number(it.total) || (Number(it.price) || 0) * qty;
        const existing = itemMap.get(key);
        if (existing) {
          existing.quantity += qty;
          existing.revenue += total;
          if (!seenInOrder.has(key)) existing.orders += 1;
        } else {
          itemMap.set(key, {
            sku: sku || "—",
            name,
            quantity: qty,
            revenue: total,
            orders: 1,
          });
        }
        seenInOrder.add(key);
      }
    }
    const topProducts = [...itemMap.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // --- New vs returning customers ---
    // A customer is "new in window" if their FIRST EVER order in the workspace
    // falls inside the window. Otherwise (had earlier orders) → returning.
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
      // Build OR filters in chunks (one per identifier type) to find first-ever
      // order date for each customer in this workspace.
      const cpfs = [...allKeys]
        .filter((k) => k.startsWith("cpf:"))
        .map((k) => k.slice(4));
      const emails = [...allKeys]
        .filter((k) => k.startsWith("email:"))
        .map((k) => k.slice(6));

      // Query smallest date per cpf
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
      if (t >= cur7Start.getTime()) newCount += 1;
      else returningCount += 1;
    }

    let prevNewCount = 0;
    let prevReturningCount = 0;
    for (const k of customersInPrev) {
      const first = firstSeen.get(k);
      if (!first) continue;
      const t = new Date(first).getTime();
      if (t >= prev7Start.getTime() && t < cur7Start.getTime()) prevNewCount += 1;
      else if (t < prev7Start.getTime()) prevReturningCount += 1;
    }

    // Totals (current window)
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
      },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CRM Overview Summary] Error:", message);
    return NextResponse.json({ ...EMPTY, error: message }, { status: 500 });
  }
}
