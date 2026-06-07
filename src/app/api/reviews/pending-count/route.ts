import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

// Contagem leve de avaliações pendentes (produto + loja) pro destaque na Overview.
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const admin = createAdminClient();

    const [prod, store, ads] = await Promise.all([
      admin.from("reviews").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "pending"),
      admin.from("store_reviews").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "pending"),
      admin.from("reviews").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("ads_status", "pending"),
    ]);

    const product = prod.count ?? 0;
    const storeC = store.count ?? 0;
    return NextResponse.json({
      product,
      store: storeC,
      ads_to_review: ads.count ?? 0,
      total: product + storeC,
    });
  } catch (e) {
    return handleAuthError(e);
  }
}
