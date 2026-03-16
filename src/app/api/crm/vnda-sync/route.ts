import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createServerClient } from "@supabase/ssr";

export const maxDuration = 300; // 5 minutes — needed for full historical sync

const PAGE_SIZE = 200;

interface VndaApiOrderItem {
  id: number;
  product_name: string;
  variant_name: string;
  sku: string;
  quantity: number;
  price: number;
  original_price?: number;
  total: number;
}

interface VndaApiOrder {
  id: number;
  code: string;
  status: string;
  first_name: string;
  last_name: string;
  email: string;
  cpf?: string;
  zip?: string;
  street_name?: string;
  street_number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  phone_area?: string;
  phone?: string;
  subtotal: number;
  discount_price: number;
  total: number;
  taxes: number;
  installments?: number;
  payment_method?: string;
  payment_gateway?: string;
  shipping_method?: string;
  shipping_label?: string;
  shipping_price?: number;
  delivery_days?: number;
  channel?: string;
  coupon_code?: string | null;
  received_at?: string | null;
  confirmed_at?: string | null;
  canceled_at?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  birthdate?: string | null;
  client_id?: number;
  items: VndaApiOrderItem[];
  discounts?: Array<{ name: string; type: string; value: number; apply_to: string; sku: string | null }>;
  shipping_address?: {
    first_name?: string;
    last_name?: string;
    street_name?: string;
    street_number?: string;
    complement?: string;
    neighborhood?: string;
    zip?: string;
    city?: string;
    state?: string;
    recipient_name?: string;
    phone?: string;
  };
}

function mapApiOrderToCrmRow(order: VndaApiOrder, workspaceId: string) {
  const clientName = [order.first_name, order.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  const phone = order.phone
    ? `${order.phone_area || ""}${order.phone}`.trim()
    : order.shipping_address?.phone || null;

  let paymentMethod: string | null = null;
  if (order.payment_method) {
    const pm = order.payment_method.toLowerCase();
    if (pm.includes("pix")) paymentMethod = "pix";
    else if (pm.includes("cart") || pm.includes("credit") || pm.includes("crédito"))
      paymentMethod = "credit_card";
    else if (pm.includes("boleto")) paymentMethod = "boleto";
    else if (pm.includes("debit") || pm.includes("débito")) paymentMethod = "debit_card";
    else paymentMethod = order.payment_method;
  }

  const items = (order.items || []).map((item) => ({
    name: item.product_name,
    sku: item.sku,
    quantity: item.quantity,
    price: item.price,
    original_price: item.original_price ?? item.price,
    total: item.total,
  }));

  const discounts = (order.discounts || []).map((d) => ({
    name: d.name,
    type: d.type,
    value: d.value,
    apply_to: d.apply_to,
    sku: d.sku,
  }));

  let birthdate: string | null = null;
  if (order.birthdate) {
    const parsed = new Date(order.birthdate);
    if (!isNaN(parsed.getTime())) {
      birthdate = parsed.toISOString().slice(0, 10);
    }
  }

  return {
    workspace_id: workspaceId,
    cliente: clientName || null,
    email: order.email || null,
    telefone: phone,
    valor: order.total ?? 0,
    data_compra: order.confirmed_at || order.received_at || new Date().toISOString(),
    cupom: order.coupon_code || null,
    numero_pedido: order.code || null,
    compras_anteriores: 0,
    source: "vnda_webhook" as const,
    source_order_id: String(order.id),
    cpf: order.cpf || null,
    birthdate,
    state: order.shipping_address?.state || order.state || null,
    city: order.shipping_address?.city || order.city || null,
    zip: order.shipping_address?.zip || order.zip || null,
    neighborhood: order.shipping_address?.neighborhood || order.neighborhood || null,
    payment_method: paymentMethod,
    installments: order.installments ?? null,
    shipping_method: order.shipping_method || null,
    shipping_price: order.shipping_price ?? null,
    delivery_days: order.delivery_days ?? null,
    subtotal: order.subtotal ?? null,
    discount_price: order.discount_price ?? null,
    channel: order.channel || null,
    items: items.length > 0 ? items : null,
    discounts: discounts.length > 0 ? discounts : null,
  };
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

export async function POST(request: NextRequest) {
  // Authenticate user
  const supabase = createSupabase(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Load VNDA connection credentials
  const { data: connection, error: connError } = await admin
    .from("vnda_connections")
    .select("api_token, store_host")
    .eq("workspace_id", workspaceId)
    .single();

  if (connError || !connection) {
    return NextResponse.json({ error: "VNDA connection not found for this workspace" }, { status: 404 });
  }

  // Decrypt API token
  let apiToken: string;
  try {
    const { decrypt } = await import("@/lib/encryption");
    apiToken = decrypt(connection.api_token as string);
  } catch {
    // If not encrypted, use raw value
    apiToken = connection.api_token as string;
  }

  const storeHost = connection.store_host as string;

  // Optionally accept a start date from request body
  let body: { startDate?: string; endDate?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Use defaults
  }

  const endDate = body.endDate || new Date().toISOString().slice(0, 10);
  // Default to fetching 90 days of history
  const startDate = body.startDate || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  })();

  // Fetch all confirmed orders from VNDA API
  const allOrders: VndaApiOrder[] = [];
  let page = 1;
  let totalPages = 1;

  console.log(`[VNDA Sync] Fetching orders from ${startDate} to ${endDate} for workspace ${workspaceId}`);

  while (page <= totalPages && page <= 500) {
    const url = new URL("https://api.vnda.com.br/api/v2/orders");
    url.searchParams.set("status", "confirmed");
    url.searchParams.set("start", startDate);
    url.searchParams.set("finish", endDate);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(PAGE_SIZE));

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
        "X-Shop-Host": storeHost,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[VNDA Sync] API error ${res.status}: ${text.slice(0, 200)}`);
      return NextResponse.json({ error: `VNDA API error: ${res.status}` }, { status: 502 });
    }

    const data: VndaApiOrder[] = await res.json();
    allOrders.push(...(data || []));

    // Parse pagination header
    const paginationHeader = res.headers.get("X-Pagination");
    if (paginationHeader) {
      try {
        const pagination = JSON.parse(paginationHeader);
        totalPages = pagination.total_pages || 1;
        console.log(`[VNDA Sync] Page ${page}/${totalPages} — ${allOrders.length} orders so far`);
      } catch {
        // Ignore
      }
    }

    if (!data || data.length < PAGE_SIZE) break;
    page++;
  }

  if (allOrders.length === 0) {
    return NextResponse.json({ synced: 0, message: "No orders found in the given date range" });
  }

  console.log(`[VNDA Sync] Total orders fetched from VNDA: ${allOrders.length}`);

  // Map all orders to crm_vendas rows
  const rows = allOrders.map((order) => mapApiOrderToCrmRow(order, workspaceId));

  // Bulk upsert in batches of 500 to avoid payload limits
  const BATCH_SIZE = 500;
  let upserted = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error: upsertError } = await admin
      .from("crm_vendas")
      .upsert(batch, { onConflict: "workspace_id, source, source_order_id", ignoreDuplicates: false });

    if (upsertError) {
      console.error(`[VNDA Sync] Upsert error on batch ${i / BATCH_SIZE + 1}:`, upsertError.message);
      errors++;
    } else {
      upserted += batch.length;
    }
  }

  console.log(`[VNDA Sync] Upserted ${upserted} rows, ${errors} batch errors`);

  // Invalidate snapshot so CRM recomputes on next load
  await admin
    .from("crm_rfm_snapshots")
    .delete()
    .eq("workspace_id", workspaceId);

  return NextResponse.json({
    synced: upserted,
    total_fetched: allOrders.length,
    batch_errors: errors,
    date_range: { startDate, endDate },
    message: `Successfully synced ${upserted} orders from VNDA. CRM snapshot invalidated — reload the CRM page to see updated counts.`,
  });
}
