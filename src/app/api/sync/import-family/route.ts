import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import { ml } from "@/lib/ml/client";
import type {
  EccosysProduto,
  HubProduct,
  MLEnrichment,
  MLEnrichmentAttr,
} from "@/types/hub";

export const maxDuration = 120;

// -------------------------------------------------------------------
// ML API types
// -------------------------------------------------------------------

interface MLCategoryAttribute {
  id: string;
  name: string;
  value_type: string;
  tags: Record<string, unknown>;
  values?: Array<{ id: string; name: string }>;
}

interface MLCategoryPrediction {
  id: string;
  name: string;
  prediction_probability: string;
  path_from_root?: Array<{ id: string; name: string }>;
}

interface MLItemFull {
  id: string;
  title: string;
  listing_type_id: string;
  condition: string;
  buying_mode: string;
  attributes: Array<{ id: string; name: string; value_name: string | null }>;
  sale_terms: Array<{ id: string; name: string; value_name: string | null }>;
  shipping: {
    mode: string;
    local_pick_up: boolean;
    free_shipping: boolean;
  };
}

// Known Eccosys → ML attribute name mapping (fallback dictionary)
const KNOWN_ATTR_MAP: Record<string, string> = {
  cor: "COLOR",
  tamanho: "SIZE",
  sabor: "FLAVOR",
  voltagem: "VOLTAGE",
  modelo: "MODEL",
  material: "MATERIAL",
  peso: "WEIGHT",
  genero: "GENDER",
};

// Normalize for accent-insensitive, case-insensitive matching
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// -------------------------------------------------------------------
// GET — Preview family + ML enrichment
// -------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspace_id required" },
      { status: 401 }
    );
  }

  const parentSku = req.nextUrl.searchParams.get("parent_sku")?.trim();
  if (!parentSku) {
    return NextResponse.json(
      { error: "parent_sku required" },
      { status: 400 }
    );
  }

  try {
    // 1. Find parent product in Eccosys
    // Support both numeric ID and SKU code as input
    let parent: EccosysProduto | undefined;

    const isNumericId = /^\d+$/.test(parentSku);

    // Strategy A: Try direct lookup by Eccosys product ID
    if (isNumericId) {
      try {
        const directProduct = await eccosys.get<EccosysProduto>(
          `/produtos/${parentSku}`,
          workspaceId
        );
        if (directProduct?.codigo && !directProduct.idProdutoPai) {
          parent = directProduct;
        }
      } catch {
        // Not an internal ID — continue to text search
      }
    }

    // Strategy B: Text search with $filter (handles SKU/name)
    if (!parent) {
      try {
        const searchResults = await eccosys.listAll<EccosysProduto>(
          "/produtos",
          workspaceId,
          { $filter: parentSku, $situacao: "A" },
          100
        );
        parent = searchResults.find(
          (p) => p.codigo === parentSku && !p.idProdutoPai
        );
      } catch {
        // $filter may return 404 for certain queries
      }
    }

    // Strategy C: Text search without situacao restriction
    if (!parent) {
      try {
        const searchResults = await eccosys.listAll<EccosysProduto>(
          "/produtos",
          workspaceId,
          { $filter: parentSku },
          100
        );
        parent = searchResults.find(
          (p) => p.codigo === parentSku && !p.idProdutoPai
        );
      } catch {
        // Still not found
      }
    }

    if (!parent) {
      return NextResponse.json(
        { error: `Produto pai "${parentSku}" nao encontrado no Eccosys. Verifique o codigo e tente novamente.` },
        { status: 404 }
      );
    }

    // 2. Find children by parent's codigo (SKU)
    const parentCodigo = parent.codigo;
    let children: EccosysProduto[] = [];

    try {
      const childSearchResults = await eccosys.listAll<EccosysProduto>(
        "/produtos",
        workspaceId,
        { $filter: parentCodigo, $situacao: "A" },
        100
      );
      children = childSearchResults.filter(
        (p) => p.codigoPai === parentCodigo && p.id !== parent!.id
      );
    } catch {
      // Children search may fail — continue with empty list
    }

    // If no children found with $situacao filter, try without
    if (children.length === 0) {
      try {
        const childSearchResults = await eccosys.listAll<EccosysProduto>(
          "/produtos",
          workspaceId,
          { $filter: parentCodigo },
          100
        );
        children = childSearchResults.filter(
          (p) => p.codigoPai === parentCodigo && p.id !== parent!.id
        );
      } catch {
        // Continue with no children
      }
    }

    // 3. Fetch parent details (images, stock, attributes)
    let parentEstoque = 0;
    try {
      const est = await eccosys.get<{ estoqueDisponivel?: number }>(
        `/estoques/${encodeURIComponent(parent.codigo)}`,
        workspaceId
      );
      parentEstoque = est?.estoqueDisponivel ?? 0;
    } catch {
      /* stock may not exist */
    }

    let parentFotos: string[] = [];
    try {
      const imgs = await eccosys.get<Array<{ url: string }>>(
        `/produtos/${parent.id}/imagens`,
        workspaceId
      );
      if (Array.isArray(imgs)) {
        parentFotos = imgs.map((i) => i.url).filter(Boolean);
      }
    } catch {
      /* fallback to inline */
    }
    if (parentFotos.length === 0) {
      parentFotos = [
        parent.foto1,
        parent.foto2,
        parent.foto3,
        parent.foto4,
        parent.foto5,
        parent.foto6,
      ].filter((f): f is string => !!f);
    }

    // Fetch attributes for first child (to detect variation attrs like Cor, Tamanho)
    let sampleAtributos: Record<string, string> = {};
    if (children.length > 0) {
      try {
        const attrs = await eccosys.get<Array<{ nome: string; valor: string }>>(
          `/produtos/${children[0].id}/atributos`,
          workspaceId
        );
        if (Array.isArray(attrs)) {
          sampleAtributos = Object.fromEntries(
            attrs.map((a) => [a.nome, a.valor])
          );
        }
      } catch {
        /* no attributes */
      }
    }

    // Check which SKUs are already in hub
    const allSkus = [parent.codigo, ...children.map((c) => c.codigo)];
    const supabase = createAdminClient();
    const { data: existing } = await supabase
      .from("hub_products")
      .select("sku")
      .eq("workspace_id", workspaceId)
      .in("sku", allSkus);
    const existingSkus = new Set((existing || []).map((r) => r.sku));

    // 3. Predict ML category from parent title
    let predictions: Array<{
      category_id: string;
      name: string;
      path: string;
      probability: string;
    }> = [];

    let mlConnected = false;
    try {
      mlConnected = await ml.isConnected(workspaceId);
    } catch {
      /* ML not connected */
    }

    if (mlConnected) {
      try {
        const preds = await ml.get<MLCategoryPrediction[]>(
          `/sites/MLB/category_predictor/predict?title=${encodeURIComponent(parent.nome)}`,
          workspaceId
        );
        if (Array.isArray(preds)) {
          predictions = preds.map((p) => ({
            category_id: p.id,
            name: p.name,
            path:
              p.path_from_root?.map((n) => n.name).join(" > ") || p.name,
            probability: p.prediction_probability,
          }));
        }
      } catch {
        /* prediction may fail */
      }
    }

    const topCategory = predictions[0] || null;

    // 4. Fetch ML category required attributes
    let categoryAttrs: MLCategoryAttribute[] = [];
    if (topCategory && mlConnected) {
      try {
        const attrs = await ml.get<MLCategoryAttribute[]>(
          `/categories/${topCategory.category_id}/attributes`,
          workspaceId
        );
        if (Array.isArray(attrs)) {
          categoryAttrs = attrs;
        }
      } catch {
        /* attrs may fail */
      }
    }

    // 5. Cross-reference with existing ML product in same category
    let crossRef: { mlItem: MLItemFull; mlItemId: string; title: string } | null =
      null;

    if (topCategory && mlConnected) {
      try {
        const { data: refProduct } = await supabase
          .from("hub_products")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("ml_category_id", topCategory.category_id)
          .not("ml_item_id", "is", null)
          .is("ecc_pai_sku", null) // prefer parents
          .limit(1)
          .single();

        if (refProduct?.ml_item_id) {
          const mlItem = await ml.get<MLItemFull>(
            `/items/${refProduct.ml_item_id}`,
            workspaceId
          );
          crossRef = {
            mlItem,
            mlItemId: refProduct.ml_item_id,
            title: (refProduct as HubProduct).nome || mlItem.title,
          };
        }
      } catch {
        /* no cross ref available */
      }
    }

    // 6. Build enrichment
    const enrichment = buildEnrichment(
      topCategory,
      categoryAttrs,
      crossRef,
      sampleAtributos
    );

    // 7. Build warnings
    const warnings: Array<{
      type: string;
      message: string;
      attribute_id?: string;
    }> = [];

    if (!topCategory) {
      warnings.push({
        type: "no_category",
        message: "Nao foi possivel predizer a categoria ML",
      });
    }

    if (!crossRef) {
      warnings.push({
        type: "no_cross_ref",
        message:
          "Nenhum produto ML encontrado nesta categoria para usar como modelo",
      });
    }

    // Check for missing required attrs
    for (const attr of enrichment.attributes) {
      if (attr.required && !attr.value_name) {
        warnings.push({
          type: "missing_required_attr",
          message: `Atributo obrigatorio "${attr.name}" nao preenchido`,
          attribute_id: attr.id,
        });
      }
    }

    // Check unmapped variation attrs
    const eccAttrKeys = Object.keys(sampleAtributos);
    for (const key of eccAttrKeys) {
      if (!enrichment.variation_attr_map[key]) {
        warnings.push({
          type: "unmapped_variation_attr",
          message: `Atributo de variacao "${key}" nao mapeado para atributo ML`,
        });
      }
    }

    return NextResponse.json({
      parent: {
        ecc_id: parent.id,
        sku: parent.codigo,
        nome: parent.nome,
        preco: parent.preco,
        foto: parentFotos[0] || null,
        estoque: parentEstoque,
        already_in_hub: existingSkus.has(parent.codigo),
      },
      children: children.map((c) => ({
        ecc_id: c.id,
        sku: c.codigo,
        nome: c.nome,
        preco: c.preco,
        estoque: 0, // stock fetched during POST
        atributos: sampleAtributos, // same shape for all children (attr values vary)
        already_in_hub: existingSkus.has(c.codigo),
      })),
      enrichment,
      predictions,
      warnings,
      cross_ref: crossRef
        ? { ml_item_id: crossRef.mlItemId, title: crossRef.title }
        : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// -------------------------------------------------------------------
// Build enrichment from category attrs + cross-ref
// -------------------------------------------------------------------

function buildEnrichment(
  category: { category_id: string; name: string; path: string } | null,
  categoryAttrs: MLCategoryAttribute[],
  crossRef: { mlItem: MLItemFull; mlItemId: string } | null,
  sampleEccAttrs: Record<string, string>
): MLEnrichment {
  const mlItem = crossRef?.mlItem;

  // Extract cross-ref attribute values for quick lookup
  const refAttrMap = new Map<string, string>();
  if (mlItem?.attributes) {
    for (const a of mlItem.attributes) {
      if (a.value_name) refAttrMap.set(a.id, a.value_name);
    }
  }

  // Build attributes list from ML category required/optional attrs
  const attributes: MLEnrichmentAttr[] = [];
  const variationAttrMap: Record<string, string> = {};

  for (const catAttr of categoryAttrs) {
    const tags = catAttr.tags || {};
    const isRequired = !!tags.required || !!tags.catalog_required;
    const isReadOnly = !!tags.read_only;
    const isVariation = !!tags.allow_variations;

    // Skip read-only attrs (ML fills them automatically)
    if (isReadOnly) continue;

    // Try to fill value:
    // 1. From cross-ref
    let valueName = refAttrMap.get(catAttr.id) || "";
    let source: MLEnrichmentAttr["source"] = "cross_ref";

    // 2. From Eccosys data (for GTIN, etc.)
    if (!valueName) {
      if (catAttr.id === "GTIN") {
        // GTIN not available in preview (only on individual products)
        valueName = "";
        source = "eccosys";
      }
    }

    // 3. Defaults for common attrs
    if (!valueName && catAttr.id === "BRAND" && refAttrMap.has("BRAND")) {
      valueName = refAttrMap.get("BRAND") || "";
      source = "cross_ref";
    }

    if (!valueName) {
      source = "default";
    }

    attributes.push({
      id: catAttr.id,
      name: catAttr.name,
      value_name: valueName,
      required: isRequired,
      source: valueName ? source : "default",
    });

    // Map variation attributes
    if (isVariation) {
      const normalizedAttrName = normalize(catAttr.name);
      for (const eccKey of Object.keys(sampleEccAttrs)) {
        if (normalize(eccKey) === normalizedAttrName) {
          variationAttrMap[eccKey] = catAttr.id;
        }
      }
      // Fallback to known map
      if (!Object.values(variationAttrMap).includes(catAttr.id)) {
        for (const [eccNorm, mlId] of Object.entries(KNOWN_ATTR_MAP)) {
          if (mlId === catAttr.id) {
            for (const eccKey of Object.keys(sampleEccAttrs)) {
              if (normalize(eccKey) === eccNorm) {
                variationAttrMap[eccKey] = catAttr.id;
              }
            }
          }
        }
      }
    }
  }

  // Extract sale_terms from cross-ref or use defaults
  const saleTerms: Array<{ id: string; value_name: string }> = [];
  if (mlItem?.sale_terms) {
    for (const st of mlItem.sale_terms) {
      if (st.value_name) {
        saleTerms.push({ id: st.id, value_name: st.value_name });
      }
    }
  }
  if (saleTerms.length === 0) {
    saleTerms.push(
      { id: "WARRANTY_TYPE", value_name: "Garantia do vendedor" },
      { id: "WARRANTY_TIME", value_name: "90 dias" }
    );
  }

  // Shipping from cross-ref or defaults
  const shipping = mlItem?.shipping
    ? {
        mode: mlItem.shipping.mode || "me2",
        local_pick_up: mlItem.shipping.local_pick_up ?? false,
        free_shipping: mlItem.shipping.free_shipping ?? false,
      }
    : { mode: "me2", local_pick_up: false, free_shipping: false };

  return {
    category_id: category?.category_id || "",
    category_name: category?.name || "",
    category_path: category?.path || "",
    listing_type_id: mlItem?.listing_type_id || "gold_special",
    condition: mlItem?.condition || "new",
    buying_mode: mlItem?.buying_mode || "buy_it_now",
    attributes,
    variation_attr_map: variationAttrMap,
    sale_terms: saleTerms,
    shipping,
    cross_ref_source: crossRef?.mlItemId || null,
    enriched_at: new Date().toISOString(),
  };
}

// -------------------------------------------------------------------
// POST — Confirm import with enrichment
// -------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspace_id required" },
      { status: 401 }
    );
  }

  const body = await req.json();
  const parentSku: string = body.parent_sku;
  const eccIds: number[] = body.ecc_ids || [];
  const enrichment: MLEnrichment | null = body.enrichment || null;

  if (!parentSku || eccIds.length === 0) {
    return NextResponse.json(
      { error: "parent_sku e ecc_ids obrigatorios" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const results: Array<{
    sku: string;
    status: "imported" | "error";
    error?: string;
  }> = [];

  for (const eccId of eccIds) {
    try {
      // Fetch full product details
      const produto = await eccosys.get<EccosysProduto>(
        `/produtos/${eccId}`,
        workspaceId
      );

      // Fetch stock
      let estoque = 0;
      try {
        const est = await eccosys.get<{ estoqueDisponivel?: number }>(
          `/estoques/${encodeURIComponent(produto.codigo)}`,
          workspaceId
        );
        estoque = est?.estoqueDisponivel ?? 0;
      } catch {
        /* continue with 0 */
      }

      // Fetch images
      let fotos: string[] = [];
      try {
        const imgs = await eccosys.get<Array<{ url: string }>>(
          `/produtos/${eccId}/imagens`,
          workspaceId
        );
        if (Array.isArray(imgs)) {
          fotos = imgs.map((i) => i.url).filter(Boolean);
        }
      } catch {
        /* fallback */
      }
      if (fotos.length === 0) {
        fotos = [
          produto.foto1,
          produto.foto2,
          produto.foto3,
          produto.foto4,
          produto.foto5,
          produto.foto6,
        ].filter((f): f is string => !!f);
      }

      // Fetch attributes
      let atributos: Record<string, string> = {};
      try {
        const attrs = await eccosys.get<Array<{ nome: string; valor: string }>>(
          `/produtos/${eccId}/atributos`,
          workspaceId
        );
        if (Array.isArray(attrs)) {
          atributos = Object.fromEntries(attrs.map((a) => [a.nome, a.valor]));
        }
      } catch {
        /* no attributes */
      }

      // Determine if this is the parent or a child
      const isParent = produto.codigo === parentSku && !produto.idProdutoPai;

      const row = {
        workspace_id: workspaceId,
        ecc_id: produto.id,
        sku: produto.codigo,
        nome: produto.nome,
        preco: produto.preco,
        preco_promocional: produto.precoPromocional,
        estoque,
        gtin: produto.gtin,
        peso: produto.peso,
        largura: produto.largura,
        altura: produto.altura,
        comprimento: produto.comprimento,
        descricao: produto.descricaoEcommerce,
        fotos,
        situacao: produto.situacao || "A",
        ecc_pai_id: produto.idProdutoPai,
        ecc_pai_sku: produto.codigoPai,
        atributos,
        source: "eccosys" as const,
        sync_status: enrichment?.category_id ? ("ready" as const) : ("draft" as const),
        ml_category_id: enrichment?.category_id || null,
        ml_enrichment: enrichment,
        last_ecc_sync: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase
        .from("hub_products")
        .upsert(row, { onConflict: "workspace_id,sku" });

      if (upsertError) {
        results.push({
          sku: produto.codigo,
          status: "error",
          error: upsertError.message,
        });
      } else {
        results.push({ sku: produto.codigo, status: "imported" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      results.push({ sku: `id:${eccId}`, status: "error", error: message });
    }
  }

  const imported = results.filter((r) => r.status === "imported").length;
  const errors = results.filter((r) => r.status === "error").length;

  // Log
  await supabase.from("hub_logs").insert({
    workspace_id: workspaceId,
    action: "import_family",
    entity: "product",
    entity_id: parentSku,
    direction: "ecc_to_hub",
    status: errors > 0 ? "error" : "ok",
    details: {
      parent_sku: parentSku,
      total: eccIds.length,
      imported,
      errors,
      has_enrichment: !!enrichment?.category_id,
    },
  });

  return NextResponse.json({
    imported,
    errors,
    parent_sku: parentSku,
    results,
  });
}
