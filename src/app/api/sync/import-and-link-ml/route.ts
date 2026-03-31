import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { ml } from "@/lib/ml/client";
import { eccosys } from "@/lib/eccosys/client";
import type { MLData, EccosysProduto, EccosysEstoque, HubProduct } from "@/types/hub";

export const maxDuration = 300;

// -------------------------------------------------------------------
// ML types & helpers (from pull-ml)
// -------------------------------------------------------------------

interface MLPicture {
  url: string;
  secure_url?: string;
}

interface MLItem {
  id: string;
  title: string;
  price: number;
  base_price?: number;
  original_price?: number;
  currency_id?: string;
  available_quantity: number;
  sold_quantity?: number;
  status: string;
  sub_status?: string[];
  permalink: string;
  category_id: string;
  domain_id?: string;
  seller_custom_field?: string;
  listing_type_id?: string;
  condition?: string;
  buying_mode?: string;
  warranty?: string;
  catalog_listing?: boolean;
  catalog_product_id?: string;
  health?: number;
  tags?: string[];
  channels?: string[];
  date_created?: string;
  last_updated?: string;
  start_time?: string;
  pictures?: MLPicture[];
  shipping?: {
    mode?: string;
    free_shipping?: boolean;
    logistic_type?: string;
  };
  variations?: Array<{
    id: number;
    seller_sku?: string;
    price: number;
    available_quantity: number;
    attribute_combinations?: Array<{ id: string; value_name: string }>;
    picture_ids?: string[];
  }>;
}

function picUrl(pic: MLPicture): string {
  return pic.secure_url || pic.url;
}

function extractMLData(item: MLItem, visits: number | null): MLData {
  return {
    listing_type_id: item.listing_type_id || "gold_special",
    condition: item.condition || "new",
    buying_mode: item.buying_mode || "buy_it_now",
    original_price: item.original_price ?? null,
    base_price: item.base_price ?? null,
    currency_id: item.currency_id || "BRL",
    catalog_listing: item.catalog_listing ?? false,
    catalog_product_id: item.catalog_product_id ?? null,
    domain_id: item.domain_id ?? null,
    free_shipping: item.shipping?.free_shipping ?? false,
    shipping_mode: item.shipping?.mode ?? null,
    logistic_type: item.shipping?.logistic_type ?? null,
    sold_quantity: item.sold_quantity ?? 0,
    health: item.health ?? null,
    visits,
    warranty: item.warranty ?? null,
    tags: item.tags || [],
    sub_status: item.sub_status || [],
    channels: item.channels || [],
    date_created: item.date_created || new Date().toISOString(),
    last_updated: item.last_updated || new Date().toISOString(),
    start_time: item.start_time ?? null,
  };
}

async function fetchVisitsBatch(
  itemIds: string[],
  workspaceId: string
): Promise<Map<string, number>> {
  const visits = new Map<string, number>();
  for (let i = 0; i < itemIds.length; i += 50) {
    const batch = itemIds.slice(i, i + 50);
    try {
      const result = await ml.get<Record<string, number>>(
        `/items/visits?ids=${batch.join(",")}`,
        workspaceId
      );
      if (result && typeof result === "object") {
        for (const [id, count] of Object.entries(result)) {
          visits.set(id, count);
        }
      }
    } catch {
      // Visits endpoint failure is non-critical
    }
  }
  return visits;
}

// -------------------------------------------------------------------
// Eccosys matching helpers (from link-eccosys / auto-link-eccosys)
// -------------------------------------------------------------------

const ML_TO_ECC_ATTR: Record<string, string[]> = {
  size: ["Tamanho", "Tamanho Tray"],
  color: ["Cor", "Cor Principal", "Cor Tray"],
  gender: ["Genero", "Gênero"],
  flavor: ["Sabor"],
  voltage: ["Voltagem"],
  model: ["Modelo"],
  material: ["Material"],
};

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseVariationType(tipoVariacao: string): string {
  return tipoVariacao.replace(/\s*tray\s*$/i, "").trim();
}

function extractVariationFromName(childName: string, parentName: string): string {
  if (!childName || !parentName) return "";
  const cn = childName.trim();
  const pn = parentName.trim();
  if (cn.startsWith(pn)) {
    const suffix = cn.slice(pn.length).trim();
    if (suffix) return suffix;
  }
  const parentWords = pn.split(/\s+/);
  const childWords = cn.split(/\s+/);
  if (childWords.length > parentWords.length) {
    return childWords.slice(parentWords.length).join(" ");
  }
  return "";
}

interface EccChild {
  id: number;
  sku: string;
  nome: string;
  estoque: number;
  atributos: Record<string, string>;
}

type EccFamily = {
  parent: { id: number; sku: string; nome: string; estoque: number };
  children: EccChild[];
};

async function fetchEccosysFamily(
  parentSku: string,
  workspaceId: string,
  stockMap?: Map<string, number>
): Promise<EccFamily | null> {
  let parent: EccosysProduto | undefined;
  try {
    const result = await eccosys.get<EccosysProduto | EccosysProduto[]>(
      `/produtos/${encodeURIComponent(parentSku)}`,
      workspaceId
    );
    const prod = Array.isArray(result) ? result[0] : result;
    if (prod?.codigo) {
      const masterIdStr = String(prod.idProdutoMaster ?? "0");
      if (masterIdStr === "0" || !prod.idProdutoMaster) {
        parent = prod;
      }
    }
  } catch {
    return null;
  }

  if (!parent) return null;

  const parentEstoque = parent._Estoque?.estoqueDisponivel ?? stockMap?.get(parent.codigo) ?? 0;
  const childSkus = parent._Skus || [];
  const children: EccChild[] = [];

  const parentAtributos: Record<string, string> = {};
  if (Array.isArray(parent._Atributos)) {
    for (const a of parent._Atributos) {
      if (a.descricao && a.valor) parentAtributos[a.descricao] = a.valor;
    }
  }

  for (const sku of childSkus) {
    try {
      const childResult = await eccosys.get<EccosysProduto | EccosysProduto[]>(
        `/produtos/${sku.id}`,
        workspaceId
      );
      const child = Array.isArray(childResult) ? childResult[0] : childResult;
      if (!child?.codigo) continue;

      // Use bulk stock map first, then _Estoque, then skip individual fetch
      const estoque = stockMap?.get(child.codigo)
        ?? child._Estoque?.estoqueDisponivel
        ?? 0;

      const atributos: Record<string, string> = {};
      if (Array.isArray(child._Atributos)) {
        for (const a of child._Atributos) {
          if (a.descricao && a.valor) atributos[a.descricao] = a.valor;
        }
      }

      children.push({ id: child.id, sku: child.codigo, nome: child.nome, estoque, atributos });
    } catch { /* skip */ }
  }

  // Inject variation attribute from name diff
  const tipoVariacao =
    parentAtributos["Tipo da Variação"] || parentAtributos["Tipo da Variacao"];
  if (tipoVariacao && children.length > 0) {
    const varKey = parseVariationType(tipoVariacao);
    if (varKey) {
      for (const child of children) {
        if (!child.atributos[varKey]) {
          const extracted = extractVariationFromName(child.nome, parent.nome);
          if (extracted) child.atributos[varKey] = extracted;
        }
      }
    }
  }

  return {
    parent: {
      id: parent.id,
      sku: parent.codigo,
      nome: parent.nome,
      estoque:
        children.length > 0
          ? children.reduce((s, c) => s + c.estoque, 0)
          : parentEstoque,
    },
    children,
  };
}

// -------------------------------------------------------------------
// POST — Import all active ML items with stock + auto-link to Eccosys
// -------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const startTime = Date.now();
  const supabase = createAdminClient();
  const errors: Array<{ ml_item_id: string; stage: string; error: string }> = [];

  // ===================================================================
  // Phase 1: Fetch ALL active ML items
  // ===================================================================
  console.log("[import-and-link-ml] Phase 1: Fetching ML items...");

  const user = await ml.get<{ id: number }>("/users/me", workspaceId);

  // Paginate through all active items
  const allItemIds: string[] = [];
  let offset = 0;
  const limit = 50;
  while (true) {
    const search = await ml.get<{
      results: string[];
      paging: { total: number; offset: number; limit: number };
    }>(
      `/users/${user.id}/items/search?status=active&offset=${offset}&limit=${limit}`,
      workspaceId
    );
    allItemIds.push(...(search.results || []));
    if (!search.paging || offset + limit >= search.paging.total) break;
    offset += limit;
  }

  if (allItemIds.length === 0) {
    return NextResponse.json({
      summary: { total_active_ml: 0, with_positive_stock: 0, already_linked: 0, imported: 0, linked: 0, unmatched: 0 },
      unmatched_items: [],
      errors: [],
    });
  }

  // Batch fetch item details
  const allItems: MLItem[] = [];
  for (let i = 0; i < allItemIds.length; i += 20) {
    const batch = allItemIds.slice(i, i + 20);
    const batchResult = await ml.get<Array<{ code: number; body: MLItem }>>(
      `/items?ids=${batch.join(",")}`,
      workspaceId
    );
    if (Array.isArray(batchResult)) {
      allItems.push(...batchResult.filter((r) => r.code === 200).map((r) => r.body));
    }
  }

  // Filter: positive stock on at least 1 variation (or the item itself)
  const withStock = allItems.filter((item) => {
    if (item.variations && item.variations.length > 0) {
      return item.variations.some((v) => v.available_quantity > 0);
    }
    return item.available_quantity > 0;
  });

  console.log(`[import-and-link-ml] Found ${allItems.length} active, ${withStock.length} with positive stock`);

  // Batch fetch visits
  const visitsMap = await fetchVisitsBatch(
    withStock.map((i) => i.id),
    workspaceId
  );

  // ===================================================================
  // Phase 2: Check which items are already in Hub
  // ===================================================================
  console.log("[import-and-link-ml] Phase 2: Checking hub state...");

  const withStockIds = withStock.map((i) => i.id);
  const { data: existingRows } = await supabase
    .from("hub_products")
    .select("ml_item_id, linked, ecc_id")
    .eq("workspace_id", workspaceId)
    .is("ml_variation_id", null)
    .in("ml_item_id", withStockIds);

  const hubState = new Map<string, { linked: boolean; ecc_id: number | null }>();
  for (const row of (existingRows || []) as Array<{ ml_item_id: string; linked: boolean; ecc_id: number | null }>) {
    hubState.set(row.ml_item_id, { linked: row.linked, ecc_id: row.ecc_id });
  }

  const alreadyLinked: string[] = [];
  const inHubUnlinked: MLItem[] = [];
  const newItems: MLItem[] = [];

  for (const item of withStock) {
    const state = hubState.get(item.id);
    if (!state) {
      newItems.push(item);
    } else if (state.linked && state.ecc_id) {
      alreadyLinked.push(item.id);
    } else {
      inHubUnlinked.push(item);
    }
  }

  console.log(`[import-and-link-ml] already_linked=${alreadyLinked.length}, in_hub_unlinked=${inHubUnlinked.length}, new=${newItems.length}`);

  // ===================================================================
  // Phase 3: Import new items into hub_products
  // ===================================================================
  console.log("[import-and-link-ml] Phase 3: Importing new items...");

  let importedCount = 0;
  const now = new Date().toISOString();

  for (const item of newItems) {
    try {
      const fotos = (item.pictures || []).map((p) => picUrl(p)).filter(Boolean);
      const mlData = extractMLData(item, visitsMap.get(item.id) ?? null);

      if (item.variations && item.variations.length > 0) {
        const variationSkus = new Set(
          item.variations.map((v) => v.seller_sku).filter(Boolean)
        );
        let parentSku = item.seller_custom_field || `ML-${item.id}`;
        if (variationSkus.has(parentSku)) parentSku = `ML-${item.id}`;

        const totalEstoque = item.variations.reduce(
          (sum, v) => sum + (v.available_quantity || 0),
          0
        );

        const hasPromo = item.original_price != null && item.original_price > item.price;

        await supabase.from("hub_products").upsert(
          {
            workspace_id: workspaceId,
            sku: parentSku,
            nome: item.title,
            preco: hasPromo ? item.original_price! : item.price,
            preco_promocional: hasPromo ? item.price : null,
            estoque: totalEstoque,
            fotos,
            ml_item_id: item.id,
            ml_variation_id: null,
            ml_category_id: item.category_id,
            ml_status: item.status,
            ml_permalink: item.permalink,
            ml_preco: item.price,
            ml_estoque: totalEstoque,
            ml_data: mlData,
            ecc_pai_sku: null,
            source: "ml" as const,
            linked: false,
            sync_status: "synced" as const,
            last_ml_sync: now,
            updated_at: now,
          },
          { onConflict: "workspace_id,sku" }
        );
        importedCount++;

        for (const variation of item.variations) {
          const childSku = variation.seller_sku || `ML-${item.id}-${variation.id}`;
          const atributos: Record<string, string> = {};
          for (const attr of variation.attribute_combinations || []) {
            atributos[attr.id.toLowerCase()] = attr.value_name;
          }
          const attrLabel = Object.values(atributos).join(", ");
          const childNome = attrLabel ? `${item.title} — ${attrLabel}` : item.title;
          const childHasPromo = item.original_price != null && item.original_price > variation.price;

          await supabase.from("hub_products").upsert(
            {
              workspace_id: workspaceId,
              sku: childSku,
              nome: childNome,
              preco: childHasPromo ? item.original_price! : variation.price,
              preco_promocional: childHasPromo ? variation.price : null,
              estoque: variation.available_quantity,
              fotos,
              atributos,
              ecc_pai_sku: parentSku,
              ml_item_id: item.id,
              ml_variation_id: variation.id,
              ml_category_id: item.category_id,
              ml_status: item.status,
              ml_permalink: item.permalink,
              ml_preco: variation.price,
              ml_estoque: variation.available_quantity,
              ml_data: mlData,
              source: "ml" as const,
              linked: false,
              sync_status: "synced" as const,
              last_ml_sync: now,
              updated_at: now,
            },
            { onConflict: "workspace_id,sku" }
          );
          importedCount++;
        }
      } else {
        const sku = item.seller_custom_field || `ML-${item.id}`;
        const simpleHasPromo = item.original_price != null && item.original_price > item.price;

        await supabase.from("hub_products").upsert(
          {
            workspace_id: workspaceId,
            sku,
            nome: item.title,
            preco: simpleHasPromo ? item.original_price! : item.price,
            preco_promocional: simpleHasPromo ? item.price : null,
            estoque: item.available_quantity,
            fotos: (item.pictures || []).map((p) => picUrl(p)).filter(Boolean),
            ml_item_id: item.id,
            ml_category_id: item.category_id,
            ml_status: item.status,
            ml_permalink: item.permalink,
            ml_preco: item.price,
            ml_estoque: item.available_quantity,
            ml_data: extractMLData(item, visitsMap.get(item.id) ?? null),
            source: "ml" as const,
            linked: false,
            sync_status: "synced" as const,
            last_ml_sync: now,
            updated_at: now,
          },
          { onConflict: "workspace_id,sku" }
        );
        importedCount++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      errors.push({ ml_item_id: item.id, stage: "import", error: msg });
    }
  }

  console.log(`[import-and-link-ml] Imported ${importedCount} rows`);

  // ===================================================================
  // Phase 4: Fetch ALL Eccosys products + stock for matching
  // ===================================================================
  const p4Start = Date.now();
  console.log("[import-and-link-ml] Phase 4: Fetching Eccosys products + stock...");

  let eccProducts: EccosysProduto[] = [];
  const eccStockMap = new Map<string, number>();

  try {
    // Fetch products and stock in sequence (Eccosys rate limit)
    eccProducts = await eccosys.listAll<EccosysProduto>(
      "/produtos",
      workspaceId,
      { $situacao: "A" },
      100
    );

    // Pre-fetch ALL stock in bulk (avoids per-child stock fetch in fetchEccosysFamily)
    const allStocks = await eccosys.listAll<EccosysEstoque>(
      "/estoques",
      workspaceId,
      undefined,
      100
    );
    for (const es of allStocks) {
      eccStockMap.set(es.codigo, es.estoqueDisponivel);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.error(`[import-and-link-ml] Eccosys fetch failed: ${msg}`);
    return NextResponse.json({
      summary: {
        total_active_ml: allItems.length,
        with_positive_stock: withStock.length,
        already_linked: alreadyLinked.length,
        already_in_hub_unlinked: inHubUnlinked.length,
        imported: importedCount,
        linked: 0,
        unmatched: newItems.length + inHubUnlinked.length,
      },
      unmatched_items: [],
      errors: [...errors, { ml_item_id: "_all", stage: "eccosys_fetch", error: msg }],
      elapsed_seconds: Math.round((Date.now() - startTime) / 1000),
    });
  }

  // Build lookup maps
  const eccBySku = new Map<string, EccosysProduto>();
  const eccParents: EccosysProduto[] = [];
  for (const p of eccProducts) {
    eccBySku.set(p.codigo, p);
    const masterStr = String(p.idProdutoMaster ?? "0");
    if (masterStr === "0" || !p.idProdutoMaster) {
      eccParents.push(p);
    }
  }

  const eccByNormalizedName = new Map<string, EccosysProduto[]>();
  for (const p of eccParents) {
    const key = normalizeForMatch(p.nome);
    const arr = eccByNormalizedName.get(key) || [];
    arr.push(p);
    eccByNormalizedName.set(key, arr);
  }

  console.log(`[import-and-link-ml] Phase 4 done in ${Math.round((Date.now() - p4Start) / 1000)}s — ${eccProducts.length} products, ${eccParents.length} parents, ${eccStockMap.size} stock entries`);

  // ===================================================================
  // Phase 5: Match ML items to Eccosys, then batch-fetch families
  // ===================================================================
  const p5Start = Date.now();
  console.log("[import-and-link-ml] Phase 5: Matching...");

  // Items to match = newly imported + already in hub but unlinked
  const itemsToLink = [...newItems, ...inHubUnlinked];
  let linkedCount = 0;
  const unmatchedItems: Array<{ ml_item_id: string; nome: string }> = [];

  // First pass: determine which Eccosys parent each ML item matches
  const mlToEccMatch = new Map<string, { eccSku: string; method: string }>();

  for (const item of itemsToLink) {
    let parentSku: string;
    if (item.variations && item.variations.length > 0) {
      const variationSkus = new Set(
        item.variations.map((v) => v.seller_sku).filter(Boolean)
      );
      parentSku = item.seller_custom_field || `ML-${item.id}`;
      if (variationSkus.has(parentSku)) parentSku = `ML-${item.id}`;
    } else {
      parentSku = item.seller_custom_field || `ML-${item.id}`;
    }

    let matchedEcc: EccosysProduto | null = null;
    let matchMethod = "";

    // Method 1: SKU exact match
    if (!parentSku.startsWith("ML-")) {
      const eccMatch = eccBySku.get(parentSku);
      if (eccMatch) {
        const masterStr = String(eccMatch.idProdutoMaster ?? "0");
        if (masterStr === "0" || !eccMatch.idProdutoMaster) {
          matchedEcc = eccMatch;
          matchMethod = "sku_exact";
        } else {
          const parent = eccProducts.find(
            (p) =>
              p.id === Number(eccMatch.idProdutoMaster) &&
              (String(p.idProdutoMaster ?? "0") === "0" || !p.idProdutoMaster)
          );
          if (parent) {
            matchedEcc = parent;
            matchMethod = "sku_child_to_parent";
          }
        }
      }
    }

    // Method 2: Exact name match
    if (!matchedEcc && item.title) {
      const normalized = normalizeForMatch(item.title);
      const candidates = eccByNormalizedName.get(normalized);
      if (candidates && candidates.length === 1) {
        matchedEcc = candidates[0];
        matchMethod = "name_exact";
      }
    }

    // Method 3: Partial name match
    if (!matchedEcc && item.title) {
      const mlNorm = normalizeForMatch(item.title);
      const candidates: EccosysProduto[] = [];
      for (const ecc of eccParents) {
        const eccNorm = normalizeForMatch(ecc.nome);
        if (eccNorm.startsWith(mlNorm) || mlNorm.startsWith(eccNorm)) {
          candidates.push(ecc);
        }
      }
      if (candidates.length === 1) {
        matchedEcc = candidates[0];
        matchMethod = "name_partial";
      }
    }

    if (!matchedEcc) {
      unmatchedItems.push({ ml_item_id: item.id, nome: item.title });
    } else {
      mlToEccMatch.set(item.id, { eccSku: matchedEcc.codigo, method: matchMethod });
    }
  }

  // Deduplicate: fetch each unique Eccosys family ONCE (with stock map to avoid individual stock calls)
  const uniqueEccParentSkus = new Set([...mlToEccMatch.values()].map((m) => m.eccSku));
  const familyCache = new Map<string, EccFamily>();

  console.log(`[import-and-link-ml] Fetching ${uniqueEccParentSkus.size} unique Eccosys families...`);
  for (const eccParentSku of uniqueEccParentSkus) {
    try {
      const family = await fetchEccosysFamily(eccParentSku, workspaceId, eccStockMap);
      if (family) familyCache.set(eccParentSku, family);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      console.error(`[import-and-link-ml] Failed to fetch family ${eccParentSku}: ${msg}`);
    }
  }

  console.log(`[import-and-link-ml] Families fetched in ${Math.round((Date.now() - p5Start) / 1000)}s, executing links...`);

  // ===================================================================
  // Phase 6: Execute linking using cached families
  // ===================================================================

  for (const item of itemsToLink) {
    const match = mlToEccMatch.get(item.id);
    if (!match) continue;

    const family = familyCache.get(match.eccSku);
    if (!family) {
      unmatchedItems.push({ ml_item_id: item.id, nome: item.title });
      continue;
    }

    try {
      // Fetch ML hub rows
      const { data: mlRows } = await supabase
        .from("hub_products")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("ml_item_id", item.id);

      if (!mlRows || mlRows.length === 0) {
        errors.push({ ml_item_id: item.id, stage: "link", error: "ML rows not found in hub" });
        continue;
      }

      const mlParent = (mlRows as HubProduct[]).find((r) => !r.ml_variation_id);
      const mlChildren = (mlRows as HubProduct[]).filter((r) => !!r.ml_variation_id);

      // Match variations
      const varMatches: Array<{ ml_id: string; ml_sku: string; ecc_id: number; ecc_sku: string; matched_by: string }> = [];
      const usedEcc = new Set<string>();

      if (mlChildren.length === 1 && family.children.length === 1) {
        varMatches.push({
          ml_id: mlChildren[0].id,
          ml_sku: mlChildren[0].sku,
          ecc_id: family.children[0].id,
          ecc_sku: family.children[0].sku,
          matched_by: "direct_1to1",
        });
        usedEcc.add(family.children[0].sku);
      } else {
        for (const mlChild of mlChildren) {
          const mlAttrs = mlChild.atributos || {};
          let bestVarMatch: { ecc: EccChild; score: number; reason: string } | null = null;

          for (const eccChild of family.children) {
            if (usedEcc.has(eccChild.sku)) continue;
            let score = 0;
            const reasons: string[] = [];

            for (const [mlKey, eccKeys] of Object.entries(ML_TO_ECC_ATTR)) {
              const mlVal = mlAttrs[mlKey];
              if (!mlVal) continue;
              for (const eccKey of eccKeys) {
                const eccVal = eccChild.atributos[eccKey];
                if (eccVal && normalize(mlVal) === normalize(eccVal)) {
                  score += 10;
                  reasons.push(`${mlKey}=${mlVal}`);
                  break;
                }
              }
            }

            if (score === 0) {
              const mlValues = Object.values(mlAttrs).map(normalize);
              const eccValues = Object.values(eccChild.atributos).map(normalize);
              for (const mv of mlValues) {
                if (mv && eccValues.includes(mv)) {
                  score += 5;
                  reasons.push(`value=${mv}`);
                }
              }
            }

            if (score > 0 && (!bestVarMatch || score > bestVarMatch.score)) {
              bestVarMatch = { ecc: eccChild, score, reason: reasons.join(", ") };
            }
          }

          if (bestVarMatch) {
            varMatches.push({
              ml_id: mlChild.id,
              ml_sku: mlChild.sku,
              ecc_id: bestVarMatch.ecc.id,
              ecc_sku: bestVarMatch.ecc.sku,
              matched_by: bestVarMatch.reason,
            });
            usedEcc.add(bestVarMatch.ecc.sku);
          }
        }
      }

      // Multi-link support: check which SKUs are already taken by OTHER ML items
      const targetSkus = [family.parent.sku, ...varMatches.map((m) => m.ecc_sku)];
      const { data: existingMlSkus } = await supabase
        .from("hub_products")
        .select("sku")
        .eq("workspace_id", workspaceId)
        .in("sku", targetSkus)
        .neq("ml_item_id", item.id);

      const takenSkus = new Set((existingMlSkus || []).map((r) => r.sku));

      // Delete conflicting Eccosys-source rows only for free SKUs
      const freeSkus = targetSkus.filter((s) => !takenSkus.has(s));
      if (freeSkus.length > 0) {
        await supabase
          .from("hub_products")
          .delete()
          .eq("workspace_id", workspaceId)
          .eq("source", "eccosys")
          .in("sku", freeSkus);
      }

      const linkNow = new Date().toISOString();
      const eccMap = new Map(family.children.map((c) => [c.sku, c]));

      // Update ML parent
      if (mlParent) {
        const canUseSku = !takenSkus.has(family.parent.sku);
        await supabase
          .from("hub_products")
          .update({
            ...(canUseSku ? { sku: family.parent.sku } : {}),
            ecc_id: family.parent.id,
            ecc_pai_sku: null,
            ecc_pai_id: null,
            estoque: family.parent.estoque,
            ml_estoque: Math.max(family.parent.estoque, 1),
            linked: true,
            last_ecc_sync: linkNow,
            updated_at: linkNow,
          })
          .eq("id", mlParent.id);
        linkedCount++;
      }

      // Update matched children
      for (const vm of varMatches) {
        const eccChild = eccMap.get(vm.ecc_sku);
        if (!eccChild) continue;
        const canUseSku = !takenSkus.has(eccChild.sku);
        await supabase
          .from("hub_products")
          .update({
            ...(canUseSku ? { sku: eccChild.sku } : {}),
            ecc_id: eccChild.id,
            ecc_pai_sku: family.parent.sku,
            ecc_pai_id: family.parent.id,
            estoque: eccChild.estoque,
            ml_estoque: Math.max(eccChild.estoque, 1),
            linked: true,
            last_ecc_sync: linkNow,
            updated_at: linkNow,
          })
          .eq("id", vm.ml_id);
        linkedCount++;
      }

      // Log this link operation
      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "link_eccosys",
        entity: "product",
        entity_id: item.id,
        direction: "ml_to_eccosys",
        status: "ok",
        details: {
          source: "import_and_link",
          match_method: match.method,
          ecc_parent_sku: family.parent.sku,
          linked: 1 + varMatches.length,
          children_matched: varMatches.length,
          sku_kept: takenSkus.size > 0,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      errors.push({ ml_item_id: item.id, stage: "link", error: msg });
    }
  }

  // Log summary
  await supabase.from("hub_logs").insert({
    workspace_id: workspaceId,
    action: "pull_ml",
    entity: "product",
    direction: "ml_to_hub",
    status: errors.length > 0 ? "error" : "ok",
    details: {
      source: "import_and_link",
      total_active_ml: allItems.length,
      with_positive_stock: withStock.length,
      already_linked: alreadyLinked.length,
      imported: importedCount,
      linked: linkedCount,
      unmatched: unmatchedItems.length,
      errors: errors.length,
    },
  });

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`[import-and-link-ml] Done in ${elapsed}s: imported=${importedCount}, linked=${linkedCount}, unmatched=${unmatchedItems.length}`);

  return NextResponse.json({
    summary: {
      total_active_ml: allItems.length,
      with_positive_stock: withStock.length,
      already_linked: alreadyLinked.length,
      already_in_hub_unlinked: inHubUnlinked.length,
      imported: importedCount,
      linked: linkedCount,
      unmatched: unmatchedItems.length,
    },
    unmatched_items: unmatchedItems,
    errors,
    elapsed_seconds: elapsed,
  });
}
