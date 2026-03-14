import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { listVndaProducts, type VndaConfig } from "@/lib/vnda-api";
import { decrypt } from "@/lib/encryption";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  // Temporary debug - will be removed after diagnosis
  if (secret !== "vtx_debug_2026") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Find workspace that has a custom_tags shelf
  const { data: customShelf } = await admin
    .from("shelf_configs")
    .select("*")
    .eq("algorithm", "custom_tags")
    .limit(1)
    .single();

  if (!customShelf) {
    return NextResponse.json({ error: "No custom_tags shelf found" });
  }

  const workspaceId = customShelf.workspace_id;

  // Get all configs for this workspace
  const { data: configs } = await admin
    .from("shelf_configs")
    .select("id, position, algorithm, title, tags, enabled, page_type")
    .eq("workspace_id", workspaceId)
    .order("page_type")
    .order("position", { ascending: true });

  // Get VNDA config
  const { data: vndaConn } = await admin
    .from("vnda_connections")
    .select("api_token, store_host")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  let sampleProducts: unknown[] = [];
  let matchSimulation = null;

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

    // Simulate custom_tags matching
    const allProducts = await listVndaProducts(config, { per_page: "100" });

    const shelfTags = customShelf.tags || [];
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
      shelf_tags_raw: customShelf.tags,
      shelf_tags_type: typeof customShelf.tags,
      shelf_tags_is_array: Array.isArray(customShelf.tags),
      target_tags: targetTags,
      total_products: allProducts.length,
      products_with_any_tags: productsWithTags.length,
      sample_product_tags: productsWithTags.slice(0, 5).map((p) => ({
        name: p.name,
        tags: p.tags.map((t) => t.name),
      })),
      matched_count: matched.length,
      matched_names: matched.slice(0, 5).map((p) => p.name),
    };
  }

  return NextResponse.json(
    {
      custom_shelf: customShelf,
      all_configs: configs || [],
      match_simulation: matchSimulation,
      sample_products: sampleProducts,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
