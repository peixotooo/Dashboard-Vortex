import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";

export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Eccosys config comes from env vars now
  const eccConfig = eccosys.getConfig();

  const [mlCred, productCounts, pendingOrders, recentErrors] =
    await Promise.all([
      // ML credentials
      supabase
        .from("ml_credentials")
        .select("ml_nickname")
        .eq("workspace_id", workspaceId)
        .single(),

      // Product counts
      supabase
        .from("hub_products")
        .select("source, linked", { count: "exact" })
        .eq("workspace_id", workspaceId),

      // Pending orders
      supabase
        .from("hub_orders")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("sync_status", "pending"),

      // Recent errors (last 24h)
      supabase
        .from("hub_logs")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "error")
        .gte("created_at", new Date(Date.now() - 86400000).toISOString()),
    ]);

  const products = productCounts.data || [];
  const totalProducts = products.length;
  const eccosysProducts = products.filter((p) => p.source === "eccosys").length;
  const mlProducts = products.filter((p) => p.source === "ml").length;
  const linkedProducts = products.filter((p) => p.linked).length;

  return NextResponse.json({
    eccosysConnected: !!eccConfig,
    eccosysAmbiente: eccConfig?.ambiente ?? null,
    mlConnected: !!mlCred.data,
    mlNickname: mlCred.data?.ml_nickname ?? null,
    totalProducts,
    eccosysProducts,
    mlProducts,
    linkedProducts,
    pendingOrders: pendingOrders.count ?? 0,
    recentErrors: recentErrors.count ?? 0,
  });
}
