// src/app/api/financeiro/abc/route.ts
//
// Returns the workspace's pre-computed ABC + profitability snapshot.
//
// Pattern espelha /api/crm/rfm: cron faz o cálculo pesado, este endpoint
// só lê o snapshot. Pra evitar trazer o jsonb gigante de orders quando
// não precisa (Bulking tem 5k+ pedidos em 90d), usamos seleção de
// colunas — só puxa a coluna `orders` no view=orders.
//
// Views:
//   ?view=summary           → summary + products top-N (default 50). NÃO lê
//                             a coluna orders. Resposta ~50KB.
//   ?view=orders&...        → orders paginados (offset/limit), ordenados
//                             por data_compra DESC. Server-side slice.
//   ?view=full              → tudo. Use só pra exports/debug, evita no
//                             load de página.
//
// Filtros (qualquer view):
//   ?abc_class=A|B|C        → filtra products (server-side)
//   ?orders_status=loss|...  → filtra orders (server-side)
//   ?orders_offset=0
//   ?orders_limit=200       → cap em 1000

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const maxDuration = 60;

interface OrderRow {
  order_id: string | null;
  numero_pedido: string | null;
  customer_email: string | null;
  data_compra: string | null;
  valor: number;
  items_revenue: number;
  items_cost: number;
  taxes: number;
  other_expenses: number;
  shipping_absorbed: number;
  discount_total: number;
  profit: number;
  margin_pct: number;
  status: "profit" | "loss" | "breakeven";
}

interface ProductRow {
  abc_class?: string;
  [k: string]: unknown;
}

interface SnapshotSummary {
  summary: Record<string, unknown>;
  products: ProductRow[];
  period_days: number;
  row_count: number;
  computed_at: string;
}

interface SnapshotFull extends SnapshotSummary {
  orders: OrderRow[];
}

const CACHE_HEADERS = { "Cache-Control": "private, max-age=300" };

function emptyResponse(message?: string) {
  return NextResponse.json(
    {
      summary: null,
      products: [],
      orders: [],
      orders_total: 0,
      computedAt: null,
      message:
        message ??
        "Snapshot ainda não computado. Aguarde o próximo cron crm-recompute (~03:00 BRT) ou rode POST /api/financeiro/abc/recompute.",
    },
    { status: 200 }
  );
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const view = request.nextUrl.searchParams.get("view") ?? "summary";
    const ordersStatus = request.nextUrl.searchParams.get("orders_status");
    const abcClass = request.nextUrl.searchParams.get("abc_class");
    const productLimit = Math.min(
      500,
      Math.max(
        1,
        parseInt(request.nextUrl.searchParams.get("product_limit") ?? "50", 10) ||
          50
      )
    );
    const ordersLimit = Math.min(
      1000,
      Math.max(
        1,
        parseInt(request.nextUrl.searchParams.get("orders_limit") ?? "200", 10) ||
          200
      )
    );
    const ordersOffset = Math.max(
      0,
      parseInt(request.nextUrl.searchParams.get("orders_offset") ?? "0", 10) || 0
    );

    const admin = createAdminClient();

    // SUMMARY view: skip orders column entirely (the heavy one).
    // Mesma técnica de /api/crm/rfm com fields=summary.
    if (view === "summary") {
      const { data, error } = await admin
        .from("crm_abc_snapshots")
        .select("summary, products, period_days, row_count, computed_at")
        .eq("workspace_id", workspaceId)
        .maybeSingle<SnapshotSummary>();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!data) return emptyResponse();

      let products = data.products ?? [];
      if (abcClass && ["A", "B", "C"].includes(abcClass.toUpperCase())) {
        products = products.filter((p) => p.abc_class === abcClass.toUpperCase());
      }

      return NextResponse.json(
        {
          summary: data.summary,
          products: products.slice(0, productLimit),
          period_days: data.period_days,
          row_count: data.row_count,
          computedAt: data.computed_at,
        },
        { headers: CACHE_HEADERS }
      );
    }

    // ORDERS view: precisa puxar a coluna orders, mas faz slice server-side
    // pra não retornar 5MB pro browser.
    if (view === "orders") {
      const { data, error } = await admin
        .from("crm_abc_snapshots")
        .select("summary, orders, period_days, row_count, computed_at")
        .eq("workspace_id", workspaceId)
        .maybeSingle<{
          summary: Record<string, unknown>;
          orders: OrderRow[];
          period_days: number;
          row_count: number;
          computed_at: string;
        }>();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!data) return emptyResponse();

      let orders = (data.orders ?? []).slice();
      if (ordersStatus && ["profit", "loss", "breakeven"].includes(ordersStatus)) {
        orders = orders.filter((o) => o.status === ordersStatus);
      }

      // Sort por data_compra DESC. Pedidos sem data caem pro fim.
      orders.sort((a, b) => {
        const aTs = a.data_compra ? Date.parse(a.data_compra) : 0;
        const bTs = b.data_compra ? Date.parse(b.data_compra) : 0;
        return bTs - aTs;
      });

      const total = orders.length;
      const slice = orders.slice(ordersOffset, ordersOffset + ordersLimit);

      return NextResponse.json(
        {
          summary: data.summary,
          orders: slice,
          orders_total: total,
          orders_offset: ordersOffset,
          orders_limit: ordersLimit,
          period_days: data.period_days,
          row_count: data.row_count,
          computedAt: data.computed_at,
        },
        { headers: CACHE_HEADERS }
      );
    }

    // FULL view: traz tudo. Use só pra debug/export.
    const { data, error } = await admin
      .from("crm_abc_snapshots")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle<SnapshotFull>();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) return emptyResponse();

    let products = data.products ?? [];
    let orders = data.orders ?? [];
    if (abcClass && ["A", "B", "C"].includes(abcClass.toUpperCase())) {
      products = products.filter((p) => p.abc_class === abcClass.toUpperCase());
    }
    if (ordersStatus && ["profit", "loss", "breakeven"].includes(ordersStatus)) {
      orders = orders.filter((o) => o.status === ordersStatus);
    }

    return NextResponse.json(
      {
        summary: data.summary,
        products,
        orders,
        period_days: data.period_days,
        row_count: data.row_count,
        computedAt: data.computed_at,
      },
      { headers: CACHE_HEADERS }
    );
  } catch (err) {
    return handleAuthError(err);
  }
}
