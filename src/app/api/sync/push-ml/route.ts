import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { ml } from "@/lib/ml/client";
import { applyPromoPrice } from "@/lib/ml/promo";
import { resolveMlCategoryId } from "@/lib/ml/categories";
import { sanitizeColorAttribute } from "@/lib/ml/attributes";
import { buildMlDescription } from "@/lib/ml/description";
import { resolveEccosysImageUrls } from "@/lib/eccosys/resolve-images";
import type { HubProduct } from "@/types/hub";

/**
 * Upload pictures to ML via multipart, return picture IDs.
 * ML cannot download from Eccosys CDN URLs, so we download and re-upload.
 */
async function uploadPicturesToML(
  urls: string[],
  workspaceId: string
): Promise<Array<{ id: string }>> {
  const resolvedUrls = await resolveEccosysImageUrls(urls);
  const pictureIds: Array<{ id: string }> = [];
  for (const url of resolvedUrls) {
    try {
      const id = await ml.uploadPicture(url, workspaceId);
      pictureIds.push({ id });
    } catch (err) {
      console.error(`Failed to upload picture ${url}:`, err);
      // Skip failed uploads instead of blocking publish
    }
  }
  return pictureIds;
}

export const maxDuration = 300;

interface PushResult {
  sku: string;
  status: "published" | "error";
  ml_item_id?: string;
  ml_permalink?: string;
  error?: string;
}

// Attribute IDs that should NOT be sent in the payload
// (either added separately with special formatting or auto-managed by ML)
const SKIP_ATTR_IDS = new Set([
  "SIZE",
  "SIZE_GRID_ID",
  "SIZE_GRID_ROW_ID",
  "ITEM_CONDITION",
  "SELLER_SKU",
  "SELLER_PACKAGE_WIDTH",
  "SELLER_PACKAGE_LENGTH",
  "SELLER_PACKAGE_HEIGHT",
  "SELLER_PACKAGE_WEIGHT",
  "GTIN",
  "EMPTY_GTIN_REASON",
  "MPN",
  "IS_KIT",
  "PRODUCT_DATA_SOURCE",
]);

// Sale terms the seller is not allowed to set (auto-managed by ML)
const SKIP_SALE_TERMS = new Set(["INSTALLMENTS_CAMPAIGN"]);

// Grade válida da Bulking para camisetas/regatas no ML (MLB31447).
// Mantida como fallback porque itens simples também exigem fashion grid.
const DEFAULT_BULKING_SIZE_GRID_ID = "2583806";

/**
 * Clean sale terms from enrichment, filtering out disallowed ones.
 */
function cleanSaleTerms(
  terms: Array<{ id: string; value_name: string }> | undefined
): Array<{ id: string; value_name: string }> {
  const cleaned = (terms || [])
    .filter((t) => t.id && t.value_name && !SKIP_SALE_TERMS.has(t.id))
    .map((t) => ({ id: t.id, value_name: t.value_name }));
  // Ensure at least WARRANTY defaults
  if (!cleaned.some((t) => t.id === "WARRANTY_TYPE")) {
    cleaned.push(
      { id: "WARRANTY_TYPE", value_name: "Garantia do vendedor" },
      { id: "WARRANTY_TIME", value_name: "90 dias" }
    );
  }
  return cleaned;
}

/**
 * Clean enrichment attributes: only {id, value_name}, skip empty and internal attrs.
 */
function cleanAttributes(
  attrs: Array<{ id: string; value_name?: string }> | undefined
): Array<{ id: string; value_name: string }> {
  if (!attrs?.length) return [];
  return attrs
    .filter((a) => a.value_name && !SKIP_ATTR_IDS.has(a.id))
    .map((a) => ({ id: a.id, value_name: a.value_name! }));
}

/**
 * Build package dimension attributes from product data.
 * ML requires values with units: "25 cm", "300 g"
 */
function buildPackageDimAttrs(product: HubProduct) {
  const h = product.altura || 3;
  const w = product.largura || 25;
  const l = product.comprimento || 25;
  const weight = product.peso || 0.3;
  return [
    { id: "SELLER_PACKAGE_HEIGHT", value_name: `${h} cm` },
    { id: "SELLER_PACKAGE_WIDTH", value_name: `${w} cm` },
    { id: "SELLER_PACKAGE_LENGTH", value_name: `${l} cm` },
    { id: "SELLER_PACKAGE_WEIGHT", value_name: `${Math.round(weight * 1000)} g` },
  ];
}

function enrichmentAttrValue(
  enrichment: HubProduct["ml_enrichment"] | undefined,
  attrId: string
): string | undefined {
  return enrichment?.attributes?.find((a) => a.id === attrId)?.value_name || undefined;
}

function resolveSizeGridId(product: HubProduct, parent?: HubProduct): string {
  return (
    enrichmentAttrValue(parent?.ml_enrichment, "SIZE_GRID_ID") ||
    enrichmentAttrValue(product.ml_enrichment, "SIZE_GRID_ID") ||
    DEFAULT_BULKING_SIZE_GRID_ID
  );
}

function normalizeSizeValue(value: string): string {
  const raw = value.trim().toUpperCase();
  if (["PP", "P", "M", "G", "GG", "XGG", "XXG", "XXGG"].includes(raw)) {
    return raw === "XXG" || raw === "XXGG" ? "XGG" : raw;
  }
  return value.trim();
}

function inferSizeValue(product: HubProduct, parent?: HubProduct): string | undefined {
  const attrs = product.atributos || {};
  for (const [key, value] of Object.entries(attrs)) {
    if (/tamanho/i.test(key) && value) return normalizeSizeValue(String(value));
  }

  const name = (product.nome || "").trim();
  const parentName = (parent?.nome || "").trim();
  if (name && parentName && name.startsWith(parentName)) {
    const suffix = name.slice(parentName.length).trim();
    if (suffix) return normalizeSizeValue(suffix);
  }

  const lastToken = name.split(/\s+/).pop() || "";
  if (/^(PP|P|M|G|GG|XGG|XXG|XXGG)$/i.test(lastToken)) {
    return normalizeSizeValue(lastToken);
  }
  return undefined;
}

function buildSizeGridAttrs(
  sizeGridId: string,
  sizeValue: string | undefined,
  sizeGridMap: Record<string, string>
): Array<{ id: string; value_name: string }> {
  const attrs: Array<{ id: string; value_name: string }> = [];
  if (sizeGridId) {
    attrs.push({ id: "SIZE_GRID_ID", value_name: sizeGridId });
  }
  if (sizeValue) {
    const rowId = sizeGridMap[sizeValue];
    if (rowId) attrs.push({ id: "SIZE_GRID_ROW_ID", value_name: rowId });
  }
  return attrs;
}

function withDefaultFashionAttrs(
  attrs: Array<{ id: string; value_name: string }>
): Array<{ id: string; value_name: string }> {
  const next = [...attrs];
  if (!next.some((a) => a.id === "AGE_GROUP")) {
    next.push({ id: "AGE_GROUP", value_name: "Adultos" });
  }
  return next;
}

function isMlWarningsOnlyValidationError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const jsonStart = err.message.indexOf("{");
  if (jsonStart < 0) return false;
  try {
    const parsed = JSON.parse(err.message.slice(jsonStart)) as {
      error?: string;
      status?: number;
      cause?: Array<{ type?: string }>;
    };
    const causes = Array.isArray(parsed.cause) ? parsed.cause : [];
    return (
      parsed.status === 400 &&
      parsed.error === "validation_error" &&
      causes.length > 0 &&
      causes.every((cause) => cause.type === "warning")
    );
  } catch {
    return false;
  }
}

/**
 * Fetch size grid row mapping from ML API.
 * Returns a map from size name (e.g. "P") to grid row ID (e.g. "2748024:1").
 */
async function fetchSizeGridMap(
  gridId: string,
  workspaceId: string
): Promise<Record<string, string>> {
  try {
    const grid = await ml.get<{
      rows: Array<{
        id: string;
        attributes: Array<{
          id: string;
          values: Array<{ name: string }>;
        }>;
      }>;
    }>(`/catalog/charts/${gridId}`, workspaceId);

    const map: Record<string, string> = {};
    for (const row of grid.rows || []) {
      const sizeAttr = row.attributes?.find((a) => a.id === "SIZE");
      const sizeName = sizeAttr?.values?.[0]?.name;
      if (sizeName) map[sizeName] = row.id;
    }
    return map;
  } catch {
    return {};
  }
}

// -------------------------------------------------------------------
// Define a descrição do anúncio. O ML (modelo UP) IGNORA o campo `description`
// no corpo do POST /items — a descrição precisa de uma chamada SEPARADA para
// POST /items/{id}/description. Sem isso o anúncio sobe sem descrição.
// -------------------------------------------------------------------
async function setItemDescription(
  itemId: string,
  text: string | null | undefined,
  workspaceId: string
): Promise<void> {
  const plain = (text || "").trim();
  if (!plain) return;
  await ml.post(`/items/${itemId}/description`, { plain_text: plain }, workspaceId);
}

// -------------------------------------------------------------------
// Build UP-model payload for a single product (no variations, has family_name)
// Each child in a variation group gets its own POST /items call
// -------------------------------------------------------------------
function buildUPPayload(
  product: HubProduct,
  parent: HubProduct,
  categoryId: string,
  sizeGridId: string,
  sizeGridMap: Record<string, string>,
  pictures: Array<{ id: string }>,
  listingTypeOverride?: string
) {
  const enr = parent.ml_enrichment;
  const baseAttrs = cleanAttributes(enr?.attributes);
  const varAttrMap = enr?.variation_attr_map || {};

  // Add variation-specific attributes (e.g. SIZE from child)
  const varAttrs: Array<{ id: string; value_name: string }> = [];
  if (product.atributos) {
    for (const [key, val] of Object.entries(product.atributos)) {
      const mlAttrId = varAttrMap[key];
      if (mlAttrId && val) {
        varAttrs.push({ id: mlAttrId, value_name: String(val) });
      }
    }
  }

  // Fallback: if SIZE is still missing, extract from child name vs parent name
  // e.g. parent="REGATA FULL HEAVY PRETA", child="REGATA FULL HEAVY PRETA P" → SIZE="P"
  if (!varAttrs.some((a) => a.id === "SIZE")) {
    const childName = (product.nome || "").trim();
    const parentName = (parent.nome || "").trim();
    if (childName && parentName && childName !== parentName) {
      let sizeFromName = "";
      if (childName.startsWith(parentName)) {
        sizeFromName = childName.slice(parentName.length).trim();
      } else {
        // Compare word by word
        const pw = parentName.split(/\s+/);
        const cw = childName.split(/\s+/);
        if (cw.length > pw.length) {
          sizeFromName = cw.slice(pw.length).join(" ");
        }
      }
      if (sizeFromName) {
        varAttrs.push({ id: "SIZE", value_name: sizeFromName });
      }
    }
  }

  // Add SIZE_GRID_ID + SIZE_GRID_ROW_ID only if grid map lookup succeeded
  const sizeValue = varAttrs.find((a) => a.id === "SIZE")?.value_name;
  const gridAttrs = buildSizeGridAttrs(sizeGridId, sizeValue, sizeGridMap);

  // GTIN from child product
  const gtinAttrs: Array<{ id: string; value_name: string }> = [];
  if (product.gtin) {
    gtinAttrs.push({ id: "GTIN", value_name: product.gtin });
  }

  const familyName = (parent.nome || parent.sku).substring(0, 60);

  return {
    family_name: familyName,
    category_id: resolveMlCategoryId(enr?.category_id || categoryId),
    price: Number(product.preco || parent.preco || 0),
    currency_id: "BRL",
    available_quantity: Math.max(product.estoque || 0, 1),
    buying_mode: enr?.buying_mode || "buy_it_now",
    listing_type_id: listingTypeOverride || enr?.listing_type_id || "gold_special",
    condition: enr?.condition || "new",
    description: { plain_text: parent.descricao || parent.nome || "" },
    pictures,
    seller_custom_field: product.sku,
    attributes: sanitizeColorAttribute(
      withDefaultFashionAttrs([
        ...baseAttrs,
        ...varAttrs,
        ...gridAttrs,
        ...buildPackageDimAttrs(parent),
        ...gtinAttrs,
      ]),
      parent.nome
    ),
    shipping: {
      mode: enr?.shipping?.mode || "me2",
      local_pick_up: enr?.shipping?.local_pick_up ?? false,
      free_shipping: enr?.shipping?.free_shipping ?? false,
    },
    sale_terms: cleanSaleTerms(enr?.sale_terms),
  };
}

// -------------------------------------------------------------------
// Build UP-model payload for a simple product (no parent/children)
// -------------------------------------------------------------------
function buildSimpleUPPayload(
  product: HubProduct,
  categoryId: string,
  sizeGridId: string,
  sizeGridMap: Record<string, string>,
  pictures: Array<{ id: string }>,
  listingTypeOverride?: string
) {
  const enr = product.ml_enrichment;
  const baseAttrs = cleanAttributes(enr?.attributes);

  // GTIN
  const gtinAttrs: Array<{ id: string; value_name: string }> = [];
  if (product.gtin && !baseAttrs.some((a) => a.id === "GTIN")) {
    gtinAttrs.push({ id: "GTIN", value_name: product.gtin });
  }

  const sizeValue = inferSizeValue(product);
  const sizeAttrs = sizeValue ? [{ id: "SIZE", value_name: sizeValue }] : [];
  const gridAttrs = buildSizeGridAttrs(sizeGridId, sizeValue, sizeGridMap);
  const familyName = (product.nome || product.sku).substring(0, 60);

  return {
    family_name: familyName,
    category_id: resolveMlCategoryId(enr?.category_id || categoryId),
    price: Number(product.preco),
    currency_id: "BRL",
    available_quantity: Math.max(product.estoque || 0, 1),
    buying_mode: enr?.buying_mode || "buy_it_now",
    listing_type_id: listingTypeOverride || enr?.listing_type_id || "gold_special",
    condition: enr?.condition || "new",
    description: { plain_text: product.descricao || product.nome || "" },
    pictures,
    seller_custom_field: product.sku,
    attributes: sanitizeColorAttribute(
      withDefaultFashionAttrs([
        ...baseAttrs,
        ...sizeAttrs,
        ...gridAttrs,
        ...buildPackageDimAttrs(product),
        ...gtinAttrs,
      ]),
      product.nome
    ),
    shipping: {
      mode: enr?.shipping?.mode || "me2",
      local_pick_up: enr?.shipping?.local_pick_up ?? false,
      free_shipping: enr?.shipping?.free_shipping ?? false,
    },
    sale_terms: cleanSaleTerms(enr?.sale_terms),
  };
}

/**
 * POST — Publish selected hub products to Mercado Livre.
 * Uses the UP (User Products) model: each variation = individual POST /items with family_name.
 * Body: { skus: string[], category_id: string, listing_type_id?: string, validate_only?: boolean }
 */
export async function POST(req: NextRequest) {
  let workspaceId: string;
  try {
    ({ workspaceId } = await getWorkspaceContext(req));
  } catch (error) {
    return handleAuthError(error);
  }
  const safeWorkspaceId = workspaceId;

  const body = await req.json();
  const skus: string[] = body.skus || [];
  const categoryId: string = body.category_id;
  const listingTypeId: string = body.listing_type_id || "";
  const validateOnly: boolean = body.validate_only === true;

  if (skus.length === 0) {
    return NextResponse.json(
      { error: "skus (array) obrigatorio" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Fetch all requested products from hub
  const { data: products, error: fetchErr } = await supabase
    .from("hub_products")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in("sku", skus);

  if (fetchErr || !products?.length) {
    return NextResponse.json(
      { error: fetchErr?.message || "Nenhum produto encontrado" },
      { status: 404 }
    );
  }

  let hubProducts = products as HubProduct[];

  const selectedParentSkus = hubProducts
    .filter((p) => !p.ecc_pai_sku)
    .map((p) => p.sku)
    .filter(Boolean);

  if (selectedParentSkus.length > 0) {
    const { data: familyChildren, error: childrenErr } = await supabase
      .from("hub_products")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("ecc_pai_sku", selectedParentSkus);

    if (childrenErr) {
      return NextResponse.json({ error: childrenErr.message }, { status: 500 });
    }

    if (familyChildren?.length) {
      const bySku = new Map(hubProducts.map((p) => [p.sku, p]));
      for (const child of familyChildren as HubProduct[]) {
        if (!bySku.has(child.sku)) bySku.set(child.sku, child);
      }
      hubProducts = Array.from(bySku.values());
    }
  }

  // Validate: either category_id in body or all products have enrichment
  if (!categoryId) {
    const missing = hubProducts.filter(
      (p) => !p.ml_item_id && !p.ml_enrichment?.category_id
    );
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `category_id obrigatorio (ou use Importar Familia para enriquecer). SKUs sem categoria: ${missing.map((p) => p.sku).join(", ")}`,
        },
        { status: 400 }
      );
    }
  }

  // -------------------------------------------------------------------
  // Reprocesso de itens excluídos no ML.
  // Se o produto tem ml_item_id mas o anúncio foi removido/encerrado lá no ML
  // (404 ou status closed/inactive), limpamos o vínculo antigo para republicá-lo
  // como NOVO. Itens ainda vivos (active/paused/under_review/...) continuam sendo
  // pulados para não duplicar — mas agora retornamos quais foram ignorados em vez
  // de sumir silenciosamente.
  const skippedLive: string[] = [];
  const reprocessedSkus: string[] = [];
  for (const p of hubProducts) {
    if (!p.ml_item_id) continue;
    let gone = false;
    try {
      const item = await ml.get<{ status?: string }>(
        `/items/${p.ml_item_id}?attributes=id,status`,
        workspaceId
      );
      const st = item?.status || "";
      gone = st === "closed" || st === "inactive";
    } catch (err) {
      // 404 = anúncio não existe mais no ML → tratar como excluído
      if (err instanceof Error && /ML 404/.test(err.message)) gone = true;
      // outros erros (rede/permissão): não arrisca, mantém o vínculo (será pulado)
    }
    if (gone) {
      p.ml_item_id = null; // flui para o caminho de publicação como item novo
      p.ml_variation_id = null;
      reprocessedSkus.push(p.sku);
    } else {
      skippedLive.push(p.sku);
    }
  }

  // Limpa em lote os vínculos antigos dos itens que serão republicados como novos
  if (reprocessedSkus.length > 0 && !validateOnly) {
    await supabase
      .from("hub_products")
      .update({
        ml_item_id: null,
        ml_permalink: null,
        ml_status: null,
        ml_variation_id: null,
        ml_preco: null,
        ml_estoque: null,
        ml_data: null,
        sync_status: "ready",
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .in("sku", reprocessedSkus);
  }

  // Group by ecc_pai_sku to identify variation families
  const variationGroups = new Map<string, HubProduct[]>();
  const potentialSimple: HubProduct[] = [];

  for (const p of hubProducts) {
    if (p.ml_item_id) continue;

    if (p.ecc_pai_sku) {
      const group = variationGroups.get(p.ecc_pai_sku) || [];
      group.push(p);
      variationGroups.set(p.ecc_pai_sku, group);
    } else {
      potentialSimple.push(p);
    }
  }

  // Filter out parents that have children in the variation groups
  const simpleProducts = potentialSimple.filter(
    (p) => !variationGroups.has(p.sku)
  );

  const results: PushResult[] = [];
  const sizeGridCache = new Map<string, Record<string, string>>();
  async function getSizeGridMapCached(sizeGridId: string) {
    if (!sizeGridCache.has(sizeGridId)) {
      sizeGridCache.set(sizeGridId, await fetchSizeGridMap(sizeGridId, safeWorkspaceId));
    }
    return sizeGridCache.get(sizeGridId)!;
  }

  // -------------------------------------------------------------------
  // Publish simple products (UP model, individual items)
  // -------------------------------------------------------------------
  for (const product of simpleProducts) {
    try {
      const pics = await uploadPicturesToML(product.fotos || [], workspaceId);
      const sizeGridId = resolveSizeGridId(product);
      const sizeGridMap = await getSizeGridMapCached(sizeGridId);
      const payload = buildSimpleUPPayload(
        product,
        categoryId,
        sizeGridId,
        sizeGridMap,
        pics,
        listingTypeId || undefined
      );

      if (validateOnly) {
        try {
          await ml.post("/items/validate", payload, workspaceId);
        } catch (err) {
          if (!isMlWarningsOnlyValidationError(err)) throw err;
        }
        results.push({ sku: product.sku, status: "published" });
        continue;
      }

      const result = await ml.post<{
        id: string;
        permalink: string;
        status: string;
      }>("/items", payload, workspaceId);

      // Descrição é uma chamada separada (o ML ignora `description` inline).
      // Gerada no padrão Bulking a partir do nome (não da descrição crua do Eccosys).
      let descWarn: string | null = null;
      try {
        const descText = buildMlDescription(product.nome || product.sku, {
          composicao: product.atributos?.["Composição"],
        });
        await setItemDescription(result.id, descText, workspaceId);
      } catch (e) {
        descWarn = `Publicado, mas descrição falhou: ${e instanceof Error ? e.message : "erro"}`;
      }

      await supabase
        .from("hub_products")
        .update({
          ml_item_id: result.id,
          ml_permalink: result.permalink,
          ml_status: result.status,
          ml_category_id: resolveMlCategoryId(product.ml_enrichment?.category_id || categoryId),
          ml_preco: Number(product.preco),
          ml_estoque: product.estoque,
          sync_status: "synced",
          linked: true,
          last_ml_sync: new Date().toISOString(),
          error_msg: descWarn,
          updated_at: new Date().toISOString(),
        })
        .eq("id", product.id);

      // Apply promotional price if set
      let promoResult: { applied: boolean; error?: string } | null = null;
      if (product.preco_promocional && product.preco_promocional > 0 && product.preco_promocional < (product.preco ?? 0)) {
        promoResult = await applyPromoPrice(result.id, product.preco_promocional, workspaceId, { delayMs: 3000 });
        if (promoResult && !promoResult.applied) {
          await supabase
            .from("hub_products")
            .update({ error_msg: `Publicado, mas promo falhou: ${promoResult.error}` })
            .eq("id", product.id);
        }
      }

      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "push_ml",
        entity: "product",
        entity_id: product.sku,
        direction: "hub_to_ml",
        status: "ok",
        details: { ml_item_id: result.id, ml_permalink: result.permalink, promo: promoResult },
      });

      results.push({
        sku: product.sku,
        status: "published",
        ml_item_id: result.id,
        ml_permalink: result.permalink,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";

      await supabase
        .from("hub_products")
        .update({
          sync_status: "error",
          error_msg: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", product.id);

      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "push_ml",
        entity: "product",
        entity_id: product.sku,
        direction: "hub_to_ml",
        status: "error",
        details: { error: message },
      });

      results.push({ sku: product.sku, status: "error", error: message });
    }
  }

  // -------------------------------------------------------------------
  // Publish variation groups (UP model: each child = individual POST)
  // -------------------------------------------------------------------
  for (const [paiSku, children] of variationGroups) {
    try {
      // Find parent product
      let parent: HubProduct | undefined;
      const { data: parentData } = await supabase
        .from("hub_products")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("sku", paiSku)
        .single();

      parent = parentData as HubProduct | undefined;
      if (!parent) parent = children[0];

      const sizeGridId = resolveSizeGridId(parent);
      const sizeGridMap = await getSizeGridMapCached(sizeGridId);

      // Resolve Eccosys image URLs once for all children (they share parent photos)
      const resolvedPics = await uploadPicturesToML(parent!.fotos || [], workspaceId);

      // Publish each child individually
      // Track if grid was rejected so we skip it for remaining children
      let gridRejected = false;

      for (const child of children) {
        try {
          const effectiveGridMap = gridRejected ? {} : sizeGridMap;
          const effectiveSizeGridId = gridRejected ? "" : sizeGridId;
          let payload = buildUPPayload(
            child,
            parent!,
            categoryId,
            effectiveSizeGridId,
            effectiveGridMap,
            resolvedPics,
            listingTypeId || undefined
          );

          if (validateOnly) {
            try {
              await ml.post("/items/validate", payload, workspaceId);
            } catch (err) {
              if (!isMlWarningsOnlyValidationError(err)) throw err;
            }
            results.push({ sku: child.sku, status: "published" });
            continue;
          }

          let result: { id: string; permalink: string; status: string };
          try {
            result = await ml.post<{
              id: string;
              permalink: string;
              status: string;
            }>("/items", payload, workspaceId);
          } catch (firstErr) {
            // If grid ID was rejected, retry without grid attrs
            const errMsg = firstErr instanceof Error ? firstErr.message : "";
            if (errMsg.includes("invalid.fashion_grid.grid_id.values") && !gridRejected) {
              gridRejected = true;
              payload = buildUPPayload(
                child,
                parent!,
                categoryId,
                "",
                {},
                resolvedPics,
                listingTypeId || undefined
              );
              result = await ml.post<{
                id: string;
                permalink: string;
                status: string;
              }>("/items", payload, workspaceId);
            } else {
              throw firstErr;
            }
          }

          // Descrição é uma chamada separada (o ML ignora `description` inline).
          // Padrão Bulking gerado do nome da família (parent.nome).
          try {
            await setItemDescription(
              result.id,
              buildMlDescription(parent!.nome || parent!.sku, {
                composicao: parent!.atributos?.["Composição"],
              }),
              workspaceId
            );
          } catch {
            /* descrição não-crítica; segue a publicação */
          }

          // Apply promotional price if set
          let childPromoResult: { applied: boolean; error?: string } | null = null;
          const promoPrice = child.preco_promocional ?? parent!.preco_promocional;
          if (promoPrice && promoPrice > 0 && promoPrice < (child.preco ?? parent!.preco ?? 0)) {
            childPromoResult = await applyPromoPrice(result.id, promoPrice, workspaceId, { delayMs: 3000 });
          }

          await supabase
            .from("hub_products")
            .update({
              ml_item_id: result.id,
              ml_permalink: result.permalink,
              ml_status: result.status,
              ml_category_id: resolveMlCategoryId(child.ml_enrichment?.category_id || categoryId),
              ml_preco: Number(child.preco),
              ml_estoque: child.estoque,
              sync_status: "synced",
              linked: true,
              last_ml_sync: new Date().toISOString(),
              error_msg: childPromoResult && !childPromoResult.applied
                ? `Publicado, mas promo falhou: ${childPromoResult.error}`
                : null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", child.id);

          await supabase.from("hub_logs").insert({
            workspace_id: workspaceId,
            action: "push_ml",
            entity: "product",
            entity_id: child.sku,
            direction: "hub_to_ml",
            status: "ok",
            details: {
              ml_item_id: result.id,
              ml_permalink: result.permalink,
              promo: childPromoResult,
            },
          });

          results.push({
            sku: child.sku,
            status: "published",
            ml_item_id: result.id,
            ml_permalink: result.permalink,
          });
        } catch (childErr) {
          const message =
            childErr instanceof Error ? childErr.message : "Erro desconhecido";

          await supabase
            .from("hub_products")
            .update({
              sync_status: "error",
              error_msg: message,
              updated_at: new Date().toISOString(),
            })
            .eq("id", child.id);

          results.push({ sku: child.sku, status: "error", error: message });
        }
      }

      // Update parent with first successful child's ML data
      const firstSuccessSku = results.find(
        (r) =>
          r.status === "published" &&
          children.some((c) => c.sku === r.sku)
      );

      if (firstSuccessSku && parentData) {
        await supabase
          .from("hub_products")
          .update({
            ml_item_id: firstSuccessSku.ml_item_id || null,
            ml_permalink: firstSuccessSku.ml_permalink || null,
            ml_status: "active",
            ml_category_id: resolveMlCategoryId(parent!.ml_enrichment?.category_id || categoryId),
            sync_status: "synced",
            linked: true,
            last_ml_sync: new Date().toISOString(),
            error_msg: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", parent!.id);
      }

      // Log
      const childResults = results.filter((r) =>
        children.some((c) => c.sku === r.sku)
      );
      const allOk = childResults.every((r) => r.status === "published");

      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "push_ml",
        entity: "product",
        entity_id: paiSku,
        direction: "hub_to_ml",
        status: allOk ? "ok" : "partial",
        details: {
          model: "user_products",
          variation_count: children.length,
          skus: children.map((c) => c.sku),
          results: childResults,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";

      for (const child of children) {
        await supabase
          .from("hub_products")
          .update({
            sync_status: "error",
            error_msg: message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", child.id);

        results.push({ sku: child.sku, status: "error", error: message });
      }

      await supabase.from("hub_logs").insert({
        workspace_id: workspaceId,
        action: "push_ml",
        entity: "product",
        entity_id: paiSku,
        direction: "hub_to_ml",
        status: "error",
        details: { error: message, skus: children.map((c) => c.sku) },
      });
    }
  }

  const published = results.filter((r) => r.status === "published").length;
  const errors = results.filter((r) => r.status === "error").length;

  return NextResponse.json({
    published,
    errors,
    reprocessed: reprocessedSkus.length,
    skipped_live: skippedLive.length,
    skipped_live_skus: skippedLive,
    validate_only: validateOnly,
    results,
  });
}
