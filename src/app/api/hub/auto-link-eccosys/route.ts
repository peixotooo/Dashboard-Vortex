import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import type { EccosysProduto, HubProduct } from "@/types/hub";

export const maxDuration = 300;

function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** ML attr ID → possible Eccosys attribute names */
const ML_TO_ECC_ATTR: Record<string, string[]> = {
  size: ["Tamanho", "Tamanho Tray"],
  color: ["Cor", "Cor Principal", "Cor Tray"],
  gender: ["Genero", "Gênero"],
  flavor: ["Sabor"],
  voltage: ["Voltagem"],
  model: ["Modelo"],
  material: ["Material"],
};

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

interface EccFamily {
  parent: { id: number; sku: string; nome: string };
  children: EccChild[];
}

/**
 * GET  — Dry-run: show proposed matches
 * POST — Execute: link matched products
 */

export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // 1. Get all ML parent products without Eccosys link
  const { data: mlParents } = await supabase
    .from("hub_products")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("source", "ml")
    .is("ecc_id", null)
    .is("ml_variation_id", null)
    .not("ml_item_id", "is", null);

  if (!mlParents || mlParents.length === 0) {
    return NextResponse.json({
      message: "Nenhum produto ML sem vinculo encontrado",
      proposals: [],
    });
  }

  // 2. Fetch ALL Eccosys products to match against
  let eccProducts: EccosysProduto[] = [];
  try {
    eccProducts = await eccosys.listAll<EccosysProduto>(
      "/produtos",
      workspaceId,
      { $situacao: "A" },
      100
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: `Falha ao buscar Eccosys: ${msg}` }, { status: 500 });
  }

  // Build Eccosys lookup maps
  const eccBySku = new Map<string, EccosysProduto>();
  const eccParents: EccosysProduto[] = [];

  for (const p of eccProducts) {
    eccBySku.set(p.codigo, p);
    const masterStr = String(p.idProdutoMaster ?? "0");
    if (masterStr === "0" || !p.idProdutoMaster) {
      eccParents.push(p);
    }
  }

  // Build normalized name index for fuzzy matching
  const eccByNormalizedName = new Map<string, EccosysProduto[]>();
  for (const p of eccParents) {
    const key = normalizeForMatch(p.nome);
    const arr = eccByNormalizedName.get(key) || [];
    arr.push(p);
    eccByNormalizedName.set(key, arr);
  }

  // 3. Try to match each ML parent to an Eccosys parent
  const proposals: Array<{
    ml_item_id: string;
    ml_sku: string;
    ml_nome: string;
    ecc_sku: string | null;
    ecc_nome: string | null;
    ecc_id: number | null;
    match_method: string;
    confidence: "high" | "medium" | "low";
    children_count: number;
  }> = [];

  for (const mlParent of mlParents as HubProduct[]) {
    let matched: EccosysProduto | null = null;
    let method = "";
    let confidence: "high" | "medium" | "low" = "low";

    // Method 1: Exact SKU match (seller_custom_field was set)
    if (!mlParent.sku.startsWith("ML-")) {
      const eccMatch = eccBySku.get(mlParent.sku);
      if (eccMatch) {
        const masterStr = String(eccMatch.idProdutoMaster ?? "0");
        if (masterStr === "0" || !eccMatch.idProdutoMaster) {
          matched = eccMatch;
          method = "sku_exact";
          confidence = "high";
        } else {
          // SKU matches a child, find the parent
          const parentId = eccMatch.idProdutoMaster;
          const parent = eccProducts.find(
            (p) => p.id === Number(parentId) &&
              (String(p.idProdutoMaster ?? "0") === "0" || !p.idProdutoMaster)
          );
          if (parent) {
            matched = parent;
            method = "sku_child_to_parent";
            confidence = "high";
          }
        }
      }
    }

    // Method 2: Exact name match
    if (!matched && mlParent.nome) {
      const normalized = normalizeForMatch(mlParent.nome);
      const candidates = eccByNormalizedName.get(normalized);
      if (candidates && candidates.length === 1) {
        matched = candidates[0];
        method = "name_exact";
        confidence = "high";
      } else if (candidates && candidates.length > 1) {
        // Multiple matches - pick first but low confidence
        matched = candidates[0];
        method = "name_exact_ambiguous";
        confidence = "low";
      }
    }

    // Method 3: Name contains/starts-with match
    if (!matched && mlParent.nome) {
      const mlNorm = normalizeForMatch(mlParent.nome);
      const candidates: EccosysProduto[] = [];
      for (const ecc of eccParents) {
        const eccNorm = normalizeForMatch(ecc.nome);
        if (eccNorm.startsWith(mlNorm) || mlNorm.startsWith(eccNorm)) {
          candidates.push(ecc);
        }
      }
      if (candidates.length === 1) {
        matched = candidates[0];
        method = "name_partial";
        confidence = "medium";
      }
    }

    // Count ML children
    const { count } = await supabase
      .from("hub_products")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("ml_item_id", mlParent.ml_item_id!)
      .not("ml_variation_id", "is", null);

    proposals.push({
      ml_item_id: mlParent.ml_item_id!,
      ml_sku: mlParent.sku,
      ml_nome: mlParent.nome || "",
      ecc_sku: matched?.codigo || null,
      ecc_nome: matched?.nome || null,
      ecc_id: matched?.id || null,
      match_method: method || "none",
      confidence: matched ? confidence : "low",
      children_count: count || 0,
    });
  }

  const matchedCount = proposals.filter((p) => p.ecc_sku).length;
  const highConfidence = proposals.filter((p) => p.confidence === "high").length;

  return NextResponse.json({
    total_ml_unlinked: mlParents.length,
    matched: matchedCount,
    high_confidence: highConfidence,
    eccosys_products_total: eccProducts.length,
    proposals,
  });
}

export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const { links } = body as {
    links: Array<{ ml_item_id: string; ecc_parent_sku: string }>;
  };

  if (!links || links.length === 0) {
    return NextResponse.json({ error: "links array required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const results: Array<{
    ml_item_id: string;
    ecc_parent_sku: string;
    linked: number;
    error?: string;
  }> = [];

  for (const link of links) {
    try {
      // Fetch Eccosys parent + children
      let parent: EccosysProduto | undefined;
      try {
        const result = await eccosys.get<EccosysProduto | EccosysProduto[]>(
          `/produtos/${encodeURIComponent(link.ecc_parent_sku)}`,
          workspaceId
        );
        const prod = Array.isArray(result) ? result[0] : result;
        if (prod?.codigo) {
          const masterStr = String(prod.idProdutoMaster ?? "0");
          if (masterStr === "0" || !prod.idProdutoMaster) {
            parent = prod;
          }
        }
      } catch {
        results.push({
          ml_item_id: link.ml_item_id,
          ecc_parent_sku: link.ecc_parent_sku,
          linked: 0,
          error: "Produto pai nao encontrado no Eccosys",
        });
        continue;
      }

      if (!parent) {
        results.push({
          ml_item_id: link.ml_item_id,
          ecc_parent_sku: link.ecc_parent_sku,
          linked: 0,
          error: "Produto pai nao encontrado no Eccosys",
        });
        continue;
      }

      // Fetch Eccosys children
      const childSkus = parent._Skus || [];
      const eccChildren: EccChild[] = [];

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

          let estoque = child._Estoque?.estoqueDisponivel ?? 0;
          if (!child._Estoque) {
            try {
              const est = await eccosys.get<{ estoqueDisponivel?: number }>(
                `/estoques/${encodeURIComponent(child.codigo)}`,
                workspaceId
              );
              estoque = est?.estoqueDisponivel ?? 0;
            } catch { /* 0 */ }
          }

          const atributos: Record<string, string> = {};
          if (Array.isArray(child._Atributos)) {
            for (const a of child._Atributos) {
              if (a.descricao && a.valor) atributos[a.descricao] = a.valor;
            }
          }

          eccChildren.push({ id: child.id, sku: child.codigo, nome: child.nome, estoque, atributos });
        } catch { /* skip */ }
      }

      // Inject variation from name diff
      const tipoVariacao = parentAtributos["Tipo da Variação"] || parentAtributos["Tipo da Variacao"];
      if (tipoVariacao && eccChildren.length > 0) {
        const varKey = parseVariationType(tipoVariacao);
        if (varKey) {
          for (const child of eccChildren) {
            if (!child.atributos[varKey]) {
              const extracted = extractVariationFromName(child.nome, parent.nome);
              if (extracted) child.atributos[varKey] = extracted;
            }
          }
        }
      }

      const parentEstoque = eccChildren.length > 0
        ? eccChildren.reduce((s, c) => s + c.estoque, 0)
        : (parent._Estoque?.estoqueDisponivel ?? 0);

      // Fetch ML hub rows
      const { data: mlRows } = await supabase
        .from("hub_products")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("ml_item_id", link.ml_item_id);

      if (!mlRows || mlRows.length === 0) {
        results.push({
          ml_item_id: link.ml_item_id,
          ecc_parent_sku: link.ecc_parent_sku,
          linked: 0,
          error: "ML item nao encontrado no Hub",
        });
        continue;
      }

      const mlParent = (mlRows as HubProduct[]).find((r) => !r.ml_variation_id);
      const mlChildren = (mlRows as HubProduct[]).filter((r) => !!r.ml_variation_id);

      // Match children
      const matches: Array<{ ml_id: string; ecc_sku: string; ecc_id: number }> = [];
      const usedEcc = new Set<string>();

      if (mlChildren.length === 1 && eccChildren.length === 1) {
        matches.push({
          ml_id: mlChildren[0].id,
          ecc_sku: eccChildren[0].sku,
          ecc_id: eccChildren[0].id,
        });
        usedEcc.add(eccChildren[0].sku);
      } else {
        for (const mlChild of mlChildren) {
          const mlAttrs = mlChild.atributos || {};
          let bestMatch: { ecc: EccChild; score: number } | null = null;

          for (const eccChild of eccChildren) {
            if (usedEcc.has(eccChild.sku)) continue;
            let score = 0;

            for (const [mlKey, eccKeys] of Object.entries(ML_TO_ECC_ATTR)) {
              const mlVal = mlAttrs[mlKey];
              if (!mlVal) continue;
              for (const eccKey of eccKeys) {
                const eccVal = eccChild.atributos[eccKey];
                if (eccVal && normalizeForMatch(mlVal) === normalizeForMatch(eccVal)) {
                  score += 10;
                  break;
                }
              }
            }

            if (score === 0) {
              const mlValues = Object.values(mlAttrs).map(normalizeForMatch);
              const eccValues = Object.values(eccChild.atributos).map(normalizeForMatch);
              for (const mv of mlValues) {
                if (mv && eccValues.includes(mv)) score += 5;
              }
            }

            if (score > 0 && (!bestMatch || score > bestMatch.score)) {
              bestMatch = { ecc: eccChild, score };
            }
          }

          if (bestMatch) {
            matches.push({
              ml_id: mlChild.id,
              ecc_sku: bestMatch.ecc.sku,
              ecc_id: bestMatch.ecc.id,
            });
            usedEcc.add(bestMatch.ecc.sku);
          }
        }
      }

      // Delete conflicting Eccosys hub rows
      const newSkus = [parent.codigo, ...matches.map((m) => m.ecc_sku)];
      await supabase
        .from("hub_products")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("source", "eccosys")
        .in("sku", newSkus);

      const now = new Date().toISOString();
      let linked = 0;
      const eccMap = new Map(eccChildren.map((c) => [c.sku, c]));

      // Update ML parent
      if (mlParent) {
        await supabase
          .from("hub_products")
          .update({
            sku: parent.codigo,
            ecc_id: parent.id,
            ecc_pai_sku: null,
            ecc_pai_id: null,
            estoque: parentEstoque,
            ml_estoque: Math.max(parentEstoque, 1),
            linked: true,
            last_ecc_sync: now,
            updated_at: now,
          })
          .eq("id", mlParent.id);
        linked++;
      }

      // Update matched children
      for (const match of matches) {
        const eccChild = eccMap.get(match.ecc_sku);
        if (!eccChild) continue;
        await supabase
          .from("hub_products")
          .update({
            sku: eccChild.sku,
            ecc_id: eccChild.id,
            ecc_pai_sku: parent.codigo,
            ecc_pai_id: parent.id,
            estoque: eccChild.estoque,
            ml_estoque: Math.max(eccChild.estoque, 1),
            linked: true,
            last_ecc_sync: now,
            updated_at: now,
          })
          .eq("id", match.ml_id);
        linked++;
      }

      results.push({
        ml_item_id: link.ml_item_id,
        ecc_parent_sku: link.ecc_parent_sku,
        linked,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      results.push({
        ml_item_id: link.ml_item_id,
        ecc_parent_sku: link.ecc_parent_sku,
        linked: 0,
        error: msg,
      });
    }
  }

  // Log
  const totalLinked = results.reduce((s, r) => s + r.linked, 0);
  await supabase.from("hub_logs").insert({
    workspace_id: workspaceId,
    action: "link_eccosys",
    entity: "product",
    direction: "ml_to_eccosys",
    status: results.some((r) => r.error) ? "error" : "ok",
    details: {
      source: "auto_link",
      total_proposals: links.length,
      total_linked: totalLinked,
      results,
    },
  });

  return NextResponse.json({ total_linked: totalLinked, results });
}
