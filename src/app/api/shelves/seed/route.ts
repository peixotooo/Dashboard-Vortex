import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { getGA4Report } from "@/lib/ga4-api";

export const maxDuration = 120;

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

/**
 * POST /api/shelves/seed
 *
 * Seeds shelf_rankings from GA4 data:
 * - bestsellers: items by purchase quantity (30 days)
 * - most_popular: items by views (7 days)
 *
 * Also inserts matching shelf_events so the cron jobs
 * can continue updating from there.
 */
export async function POST(request: NextRequest) {
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
      return NextResponse.json(
        { error: "Workspace not specified" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // 1. Load shelf_products for name matching
    const { data: shelfProducts } = await admin
      .from("shelf_products")
      .select("product_id, name")
      .eq("workspace_id", workspaceId)
      .eq("active", true);

    if (!shelfProducts || shelfProducts.length === 0) {
      return NextResponse.json(
        { error: "No products in catalog. Sync VNDA first." },
        { status: 400 }
      );
    }

    // Build name -> product_id lookup with normalized names
    const productLookup = shelfProducts.map((p) => ({
      id: p.product_id,
      name: p.name,
      normalized: normalize(p.name),
    }));

    // 2. Fetch BestSellers from GA4 (purchases last 30 days)
    const bestsellersReport = await getGA4Report({
      datePreset: "last_30d",
      dimensions: ["itemName"],
      metrics: ["itemPurchaseQuantity", "itemRevenue"],
      limit: 100,
      orderBy: { metric: "itemPurchaseQuantity", desc: true },
    });

    // 3. Fetch MostPopular from GA4 (views last 7 days)
    const popularReport = await getGA4Report({
      datePreset: "last_7d",
      dimensions: ["itemName"],
      metrics: ["itemsViewed"],
      limit: 100,
      orderBy: { metric: "itemsViewed", desc: true },
    });

    // 4. Match GA4 item names to shelf_products and build rankings
    let bestsellersSeeded = 0;
    let popularSeeded = 0;
    let unmatched = 0;

    // BestSellers rankings
    const bestsellersRows: Array<{
      workspace_id: string;
      algorithm: string;
      product_id: string;
      score: number;
    }> = [];

    for (const row of bestsellersReport.rows) {
      const ga4Name = row.dimensions.itemName || "";
      const purchases = row.metrics.itemPurchaseQuantity || 0;
      if (purchases <= 0) continue;

      const match = findBestMatch(ga4Name, productLookup);
      if (match) {
        bestsellersRows.push({
          workspace_id: workspaceId,
          algorithm: "bestsellers",
          product_id: match.id,
          score: purchases,
        });
        bestsellersSeeded++;
      } else {
        unmatched++;
      }
    }

    // MostPopular rankings
    const popularRows: Array<{
      workspace_id: string;
      algorithm: string;
      product_id: string;
      score: number;
    }> = [];

    for (const row of popularReport.rows) {
      const ga4Name = row.dimensions.itemName || "";
      const views = row.metrics.itemsViewed || 0;
      if (views <= 0) continue;

      const match = findBestMatch(ga4Name, productLookup);
      if (match) {
        popularRows.push({
          workspace_id: workspaceId,
          algorithm: "most_popular",
          product_id: match.id,
          score: views,
        });
        popularSeeded++;
      }
    }

    // 5. Upsert rankings in batches
    if (bestsellersRows.length > 0) {
      await admin.from("shelf_rankings").upsert(bestsellersRows, {
        onConflict: "workspace_id,algorithm,product_id",
        ignoreDuplicates: false,
      });
    }

    if (popularRows.length > 0) {
      await admin.from("shelf_rankings").upsert(popularRows, {
        onConflict: "workspace_id,algorithm,product_id",
        ignoreDuplicates: false,
      });
    }

    return NextResponse.json({
      ok: true,
      bestsellers: bestsellersSeeded,
      most_popular: popularSeeded,
      unmatched,
      total_products: shelfProducts.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Shelves Seed]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// --- Name matching (reuses pattern from products-intelligence.ts) ---

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(a.split(" ").filter(Boolean));
  const tokensB = new Set(b.split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

interface ProductEntry {
  id: string;
  name: string;
  normalized: string;
}

function findBestMatch(
  ga4Name: string,
  products: ProductEntry[]
): ProductEntry | null {
  const normalizedGA4 = normalize(ga4Name);

  // Exact match first
  const exact = products.find((p) => p.normalized === normalizedGA4);
  if (exact) return exact;

  // Fuzzy match with token overlap
  let bestMatch: ProductEntry | null = null;
  let bestScore = 0;

  for (const p of products) {
    const score = tokenOverlap(normalizedGA4, p.normalized);
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      bestMatch = p;
    }
  }

  return bestMatch;
}
