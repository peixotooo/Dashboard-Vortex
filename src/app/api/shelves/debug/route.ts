import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";
import { listVndaProducts, type VndaConfig } from "@/lib/vnda-api";
import { decrypt } from "@/lib/encryption";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS_HEADERS });
  }

  const admin = createAdminClient();

  // Get shelf configs
  const { data: configs } = await admin
    .from("shelf_configs")
    .select("id, position, algorithm, title, tags, enabled, page_type")
    .eq("workspace_id", auth.workspaceId)
    .order("page_type")
    .order("position", { ascending: true });

  // Get VNDA config
  const { data: vndaConn } = await admin
    .from("vnda_connections")
    .select("api_token, store_host")
    .eq("workspace_id", auth.workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  let sampleProducts: unknown[] = [];
  if (vndaConn?.api_token && vndaConn?.store_host) {
    const config: VndaConfig = {
      apiToken: decrypt(vndaConn.api_token),
      storeHost: vndaConn.store_host as string,
    };

    const products = await listVndaProducts(config, { per_page: "5" });
    sampleProducts = products.map((p) => ({
      id: p.id,
      name: p.name,
      available: p.available,
      tags: p.tags,
      tags_type: typeof p.tags,
      tags_is_array: Array.isArray(p.tags),
    }));
  }

  // Find custom_tags shelf and simulate matching
  const customTagsShelf = (configs || []).find((c) => c.algorithm === "custom_tags");
  let matchSimulation = null;
  if (customTagsShelf && vndaConn?.api_token) {
    const config: VndaConfig = {
      apiToken: decrypt(vndaConn.api_token),
      storeHost: vndaConn.store_host as string,
    };
    const allProducts = await listVndaProducts(config, { per_page: "100" });

    const shelfTags = customTagsShelf.tags || [];
    const targetTags = Array.isArray(shelfTags)
      ? shelfTags.map((t: string) => t.toLowerCase().trim())
      : [];

    const productsWithTags = allProducts.filter(
      (p) => p.tags && Array.isArray(p.tags) && p.tags.length > 0
    );

    const matched = allProducts.filter((p) => {
      if (p.available === false || !p.tags || !Array.isArray(p.tags)) return false;
      const productTagNames = p.tags.map((tag) =>
        (tag.name || "").toLowerCase().trim()
      );
      return targetTags.every((target: string) => productTagNames.includes(target));
    });

    matchSimulation = {
      shelf_tags_raw: customTagsShelf.tags,
      shelf_tags_type: typeof customTagsShelf.tags,
      target_tags: targetTags,
      total_products: allProducts.length,
      products_with_any_tags: productsWithTags.length,
      sample_product_tags: productsWithTags.slice(0, 3).map((p) => ({
        name: p.name,
        tags: p.tags.map((t) => t.name),
      })),
      matched_count: matched.length,
      matched_names: matched.slice(0, 5).map((p) => p.name),
    };
  }

  return NextResponse.json(
    {
      workspace_id: auth.workspaceId,
      configs: configs || [],
      custom_tags_shelf: customTagsShelf || null,
      match_simulation: matchSimulation,
      sample_products: sampleProducts,
    },
    { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } }
  );
}
