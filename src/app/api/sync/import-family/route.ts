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
  domain_id: string;
  domain_name: string;
  category_id: string;
  category_name: string;
  attributes: unknown[];
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

// Extract photos from Eccosys product (images endpoint returns string[])
function extractPhotos(product: EccosysProduto, imgs?: unknown): string[] {
  // The /produtos/{id}/imagens endpoint returns string[] directly
  if (Array.isArray(imgs)) {
    const urls = imgs
      .map((item) => (typeof item === "string" ? item : (item as { url?: string })?.url))
      .filter((u): u is string => !!u);
    if (urls.length > 0) return urls;
  }
  // Fallback to inline foto1-foto4 fields
  return [product.foto1, product.foto2, product.foto3, product.foto4, product.foto5, product.foto6]
    .filter((f): f is string => !!f);
}

// -------------------------------------------------------------------
// GET — Preview family + ML enrichment
// Uses Eccosys individual GET which returns _Skus, _Atributos, _Estoque
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
    // 1. Fetch parent product via GET /produtos/{id ou codigo}
    //    This returns _Skus, _Atributos, _Estoque, _FichaTecnica embedded
    let parent: EccosysProduto | undefined;

    try {
      const result = await eccosys.get<EccosysProduto | EccosysProduto[]>(
        `/produtos/${encodeURIComponent(parentSku)}`,
        workspaceId
      );
      // API may return single object or array
      const prod = Array.isArray(result) ? result[0] : result;
      if (prod?.codigo) {
        // Verify it's a parent (idProdutoMaster === "0" or 0) or simple product
        const masterIdStr = String(prod.idProdutoMaster ?? "0");
        if (masterIdStr === "0" || !prod.idProdutoMaster) {
          parent = prod;
        }
      }
    } catch {
      // Direct lookup failed
    }

    if (!parent) {
      return NextResponse.json(
        {
          error: `Produto pai "${parentSku}" nao encontrado no Eccosys. Verifique o codigo e tente novamente.`,
        },
        { status: 404 }
      );
    }

    // 2. Get children from _Skus (embedded in the parent response)
    const childSkus = parent._Skus || [];

    // Fetch full details for each child via GET /produtos/{id}
    const childrenDetails: Array<{
      product: EccosysProduto;
      estoque: number;
      atributos: Record<string, string>;
      fotos: string[];
    }> = [];

    for (const sku of childSkus) {
      try {
        const childResult = await eccosys.get<EccosysProduto | EccosysProduto[]>(
          `/produtos/${sku.id}`,
          workspaceId
        );
        const child = Array.isArray(childResult) ? childResult[0] : childResult;
        if (!child?.codigo) continue;

        // Stock from embedded _Estoque or fallback to /estoques/{codigo}
        let estoque = child._Estoque?.estoqueDisponivel ?? 0;
        if (!child._Estoque) {
          try {
            const est = await eccosys.get<{ estoqueDisponivel?: number }>(
              `/estoques/${encodeURIComponent(child.codigo)}`,
              workspaceId
            );
            estoque = est?.estoqueDisponivel ?? 0;
          } catch { /* continue with 0 */ }
        }

        // Attributes from embedded _Atributos (descricao + valor)
        const atributos: Record<string, string> = {};
        if (Array.isArray(child._Atributos)) {
          for (const a of child._Atributos) {
            if (a.descricao && a.valor) {
              atributos[a.descricao] = a.valor;
            }
          }
        }

        // Images
        let imgs: unknown;
        try {
          imgs = await eccosys.get(`/produtos/${sku.id}/imagens`, workspaceId);
        } catch { /* no images */ }
        const fotos = extractPhotos(child, imgs);

        childrenDetails.push({ product: child, estoque, atributos, fotos });
      } catch {
        // Skip failed children
      }
    }

    // 3. Parent details
    const parentEstoque = parent._Estoque?.estoqueDisponivel ?? 0;

    let parentImgs: unknown;
    try {
      parentImgs = await eccosys.get(`/produtos/${parent.id}/imagens`, workspaceId);
    } catch { /* no images */ }
    const parentFotos = extractPhotos(parent, parentImgs);

    // Parent attributes from _Atributos
    const parentAtributos: Record<string, string> = {};
    if (Array.isArray(parent._Atributos)) {
      for (const a of parent._Atributos) {
        if (a.descricao && a.valor) {
          parentAtributos[a.descricao] = a.valor;
        }
      }
    }

    // Sample attributes from first child (for variation attribute mapping)
    const sampleAtributos = childrenDetails[0]?.atributos || {};

    // Check which SKUs are already in hub
    const allSkus = [parent.codigo, ...childrenDetails.map((c) => c.product.codigo)];
    const supabase = createAdminClient();
    const { data: existing } = await supabase
      .from("hub_products")
      .select("sku")
      .eq("workspace_id", workspaceId)
      .in("sku", allSkus);
    const existingSkus = new Set((existing || []).map((r) => r.sku));

    // 4. Predict ML category from parent title (PUBLIC API — no auth needed)
    //    Uses /sites/MLB/domain_discovery/search endpoint
    let predictions: Array<{
      category_id: string;
      name: string;
      path: string;
      probability: string;
    }> = [];

    try {
      const predUrl = `https://api.mercadolibre.com/sites/MLB/domain_discovery/search?q=${encodeURIComponent(parent.nome)}`;
      const predRes = await fetch(predUrl);
      if (predRes.ok) {
        const preds: MLCategoryPrediction[] = await predRes.json();
        if (Array.isArray(preds)) {
          // Deduplicate by category_id (same category can appear multiple times)
          const seen = new Set<string>();
          predictions = preds
            .filter((p) => {
              if (seen.has(p.category_id)) return false;
              seen.add(p.category_id);
              return true;
            })
            .map((p) => ({
              category_id: p.category_id,
              name: p.category_name,
              path: `${p.domain_name} > ${p.category_name}`,
              probability: "domain_discovery",
            }));
        }
      }
    } catch {
      /* prediction may fail */
    }

    const topCategory = predictions[0] || null;

    // 5. Fetch ML category required attributes (PUBLIC API — no auth needed)
    let categoryAttrs: MLCategoryAttribute[] = [];
    if (topCategory) {
      try {
        const attrUrl = `https://api.mercadolibre.com/categories/${topCategory.category_id}/attributes`;
        const attrRes = await fetch(attrUrl);
        if (attrRes.ok) {
          const attrs: MLCategoryAttribute[] = await attrRes.json();
          if (Array.isArray(attrs)) {
            categoryAttrs = attrs;
          }
        }
      } catch {
        /* attrs may fail */
      }
    }

    // 6. Cross-reference with existing ML product in same category
    let crossRef: { mlItem: MLItemFull; mlItemId: string; title: string } | null =
      null;

    let mlConnected = false;
    try {
      mlConnected = await ml.isConnected(workspaceId);
    } catch {
      /* ML not connected */
    }

    if (topCategory && mlConnected) {
      try {
        const { data: refProduct } = await supabase
          .from("hub_products")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("ml_category_id", topCategory.category_id)
          .not("ml_item_id", "is", null)
          .is("ecc_pai_sku", null)
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

    // 7. Build enrichment
    const enrichment = buildEnrichment(
      topCategory,
      categoryAttrs,
      crossRef,
      sampleAtributos
    );

    // 8. Build warnings
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

    for (const attr of enrichment.attributes) {
      if (attr.required && !attr.value_name) {
        warnings.push({
          type: "missing_required_attr",
          message: `Atributo obrigatorio "${attr.name}" nao preenchido`,
          attribute_id: attr.id,
        });
      }
    }

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
      children: childrenDetails.map((d) => ({
        ecc_id: d.product.id,
        sku: d.product.codigo,
        nome: d.product.nome,
        preco: d.product.preco,
        estoque: d.estoque,
        atributos: d.atributos,
        already_in_hub: existingSkus.has(d.product.codigo),
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

  const refAttrMap = new Map<string, string>();
  if (mlItem?.attributes) {
    for (const a of mlItem.attributes) {
      if (a.value_name) refAttrMap.set(a.id, a.value_name);
    }
  }

  const attributes: MLEnrichmentAttr[] = [];
  const variationAttrMap: Record<string, string> = {};

  for (const catAttr of categoryAttrs) {
    const tags = catAttr.tags || {};
    const isRequired = !!tags.required || !!tags.catalog_required;
    const isReadOnly = !!tags.read_only;
    const isVariation = !!tags.allow_variations;

    if (isReadOnly) continue;

    let valueName = refAttrMap.get(catAttr.id) || "";
    let source: MLEnrichmentAttr["source"] = "cross_ref";

    if (!valueName && catAttr.id === "GTIN") {
      valueName = "";
      source = "eccosys";
    }

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

    if (isVariation) {
      const normalizedAttrName = normalize(catAttr.name);
      for (const eccKey of Object.keys(sampleEccAttrs)) {
        if (normalize(eccKey) === normalizedAttrName) {
          variationAttrMap[eccKey] = catAttr.id;
        }
      }
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
// Uses GET /produtos/{id} which returns all nested data
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
  const eccIds: (number | string)[] = body.ecc_ids || [];
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
      // Fetch full product details (includes _Estoque, _Atributos, etc.)
      const result = await eccosys.get<EccosysProduto | EccosysProduto[]>(
        `/produtos/${eccId}`,
        workspaceId
      );
      const produto = Array.isArray(result) ? result[0] : result;

      if (!produto?.codigo) {
        results.push({ sku: `id:${eccId}`, status: "error", error: "Produto nao encontrado" });
        continue;
      }

      // Stock: prefer embedded _Estoque, fallback to /estoques/{codigo}
      let estoque = produto._Estoque?.estoqueDisponivel ?? 0;
      if (!produto._Estoque) {
        try {
          const est = await eccosys.get<{ estoqueDisponivel?: number }>(
            `/estoques/${encodeURIComponent(produto.codigo)}`,
            workspaceId
          );
          estoque = est?.estoqueDisponivel ?? 0;
        } catch { /* continue with 0 */ }
      }

      // Images: /produtos/{id}/imagens returns string[] directly
      let fotos: string[] = [];
      try {
        const imgs = await eccosys.get(`/produtos/${produto.id}/imagens`, workspaceId);
        fotos = extractPhotos(produto, imgs);
      } catch {
        fotos = extractPhotos(produto);
      }

      // Attributes from _Atributos (descricao + valor)
      const atributos: Record<string, string> = {};
      if (Array.isArray(produto._Atributos)) {
        for (const a of produto._Atributos) {
          if (a.descricao && a.valor) {
            atributos[a.descricao] = a.valor;
          }
        }
      }

      // Determine parent vs child
      const masterIdStr = String(produto.idProdutoMaster ?? "0");
      const isParent = masterIdStr === "0" || !produto.idProdutoMaster;

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
        ecc_pai_id: isParent ? null : Number(produto.idProdutoMaster) || produto.idProdutoPai,
        ecc_pai_sku: isParent ? null : (produto.codigoPai || parentSku),
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
