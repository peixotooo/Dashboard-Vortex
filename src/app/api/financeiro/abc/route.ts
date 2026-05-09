// src/app/api/financeiro/abc/route.ts
//
// Returns the workspace's pre-computed ABC + profitability snapshot.
// The heavy lifting (Pareto + per-order P&L) runs as a side-effect of
// the crm-compute cron (lib/financeiro/recompute.ts) — this endpoint
// just serves the cached jsonb.
//
// Query params:
//   ?view=summary            → returns summary + product top-N (default 50)
//   ?view=full               → returns everything (products + orders + summary)
//   ?orders_status=loss      → filters orders to "loss" only
//   ?abc_class=A|B|C         → filters products to that class
//
// All queries hit the snapshot — never recomputes. To force a refresh,
// the user/cron should hit /api/crm/compute (existing) which now also
// kicks off ABC recompute.

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";

export const maxDuration = 15;

interface AbcSnapshot {
  workspace_id: string;
  period_days: number;
  products: unknown[];
  orders: unknown[];
  summary: Record<string, unknown>;
  row_count: number;
  computed_at: string;
}

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

    const view = request.nextUrl.searchParams.get("view") ?? "summary";
    const ordersStatus = request.nextUrl.searchParams.get("orders_status");
    const abcClass = request.nextUrl.searchParams.get("abc_class");
    const productLimit = Math.min(
      500,
      Math.max(1, parseInt(request.nextUrl.searchParams.get("product_limit") ?? "50", 10) || 50)
    );

    const admin = createAdminClient();
    const { data: snapshot, error } = await admin
      .from("crm_abc_snapshots")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle<AbcSnapshot>();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!snapshot) {
      return NextResponse.json(
        {
          summary: null,
          products: [],
          orders: [],
          computedAt: null,
          message:
            "Snapshot ainda não computado. Rode POST /api/crm/compute (ou aguarde o cron crm-recompute).",
        },
        { status: 200 }
      );
    }

    let products = snapshot.products as Array<{ abc_class?: string }>;
    let orders = snapshot.orders as Array<{ status?: string }>;

    if (abcClass && ["A", "B", "C"].includes(abcClass.toUpperCase())) {
      products = products.filter((p) => p.abc_class === abcClass.toUpperCase());
    }
    if (ordersStatus && ["profit", "loss", "breakeven"].includes(ordersStatus)) {
      orders = orders.filter((o) => o.status === ordersStatus);
    }

    if (view === "summary") {
      // Light response: top-N products + summary, no full orders list.
      // Frontend can paginate orders via ?view=full when needed.
      return NextResponse.json(
        {
          summary: snapshot.summary,
          products: products.slice(0, productLimit),
          period_days: snapshot.period_days,
          row_count: snapshot.row_count,
          computedAt: snapshot.computed_at,
        },
        { headers: { "Cache-Control": "private, max-age=300" } }
      );
    }

    return NextResponse.json(
      {
        summary: snapshot.summary,
        products,
        orders,
        period_days: snapshot.period_days,
        row_count: snapshot.row_count,
        computedAt: snapshot.computed_at,
      },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
