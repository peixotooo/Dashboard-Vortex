import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { syncGiftRequestConversions } from "@/lib/gift-request/conversions";

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

async function authorize(request: NextRequest) {
  const supabase = createSupabase(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", status: 401 as const };

  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId)
    return { error: "Workspace not specified", status: 400 as const };

  return { user, workspaceId };
}

type SaleRevenueRow = {
  id: string;
  valor: number | string | null;
  source_order_id: string | null;
  numero_pedido: string | null;
  ordem_compra: string | null;
};

const ORDER_CODE_COLUMNS = ["numero_pedido", "source_order_id", "ordem_compra"] as const;

function toNumber(value: number | string | null | undefined): number {
  const num = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(num) ? Number(num) : 0;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchConvertedRevenue(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  orderCodes: string[]
) {
  const codes = Array.from(
    new Set(orderCodes.map((code) => code.trim()).filter(Boolean))
  );
  if (codes.length === 0) {
    return { revenue: 0, order_count: 0, avg_order_value: 0 };
  }

  const rowsById = new Map<string, SaleRevenueRow>();
  for (const codesChunk of chunk(codes, 100)) {
    for (const column of ORDER_CODE_COLUMNS) {
      const { data, error } = await admin
        .from("crm_vendas")
        .select("id, valor, source_order_id, numero_pedido, ordem_compra")
        .eq("workspace_id", workspaceId)
        .in(column, codesChunk);

      if (error) throw new Error(error.message);
      for (const row of (data || []) as SaleRevenueRow[]) {
        rowsById.set(row.id, row);
      }
    }

    const { data: idRows, error: idError } = await admin
      .from("crm_vendas")
      .select("id, valor, source_order_id, numero_pedido, ordem_compra")
      .eq("workspace_id", workspaceId)
      .in("id", codesChunk);

    if (!idError) {
      for (const row of (idRows || []) as SaleRevenueRow[]) {
        rowsById.set(row.id, row);
      }
    }
  }

  const revenue = Array.from(rowsById.values()).reduce(
    (sum, row) => sum + toNumber(row.valor),
    0
  );
  const orderCount = rowsById.size;

  return {
    revenue: Number(revenue.toFixed(2)),
    order_count: orderCount,
    avg_order_value:
      orderCount > 0 ? Number((revenue / orderCount).toFixed(2)) : 0,
  };
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth)
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();

  try {
    await syncGiftRequestConversions({
      admin,
      workspaceId: auth.workspaceId,
    });
  } catch (err) {
    console.error("[GiftRequest Stats] conversion sync failed:", err);
  }

  const { data, error } = await admin
    .from("gift_requests")
    .select("status, created_at, read_at, converted_at, converted_order_id, product_id")
    .eq("workspace_id", auth.workspaceId)
    .gte(
      "created_at",
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data || [];
  const total = rows.length;
  const byStatus: Record<string, number> = {};
  const byProduct: Record<string, number> = {};
  let read = 0;
  let converted = 0;
  const convertedOrderCodes: string[] = [];

  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    if (r.read_at) read++;
    if (r.converted_at) {
      converted++;
      if (r.converted_order_id) convertedOrderCodes.push(r.converted_order_id);
    }
    if (r.product_id) byProduct[r.product_id] = (byProduct[r.product_id] || 0) + 1;
  }

  const convertedRevenue = await fetchConvertedRevenue(
    admin,
    auth.workspaceId,
    convertedOrderCodes
  );

  const topProducts = Object.entries(byProduct)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([product_id, count]) => ({ product_id, count }));

  return NextResponse.json({
    total,
    by_status: byStatus,
    read,
    read_rate: total ? read / total : 0,
    converted,
    conversion_rate: total ? converted / total : 0,
    converted_revenue: convertedRevenue.revenue,
    converted_revenue_orders: convertedRevenue.order_count,
    avg_converted_order_value: convertedRevenue.avg_order_value,
    top_products: topProducts,
  });
}
