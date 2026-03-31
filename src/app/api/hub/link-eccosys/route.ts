import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import type { EccosysProduto, HubProduct } from "@/types/hub";

export const maxDuration = 120;

// -------------------------------------------------------------------
// Attribute matching: ML uses lowercase IDs, Eccosys uses PT names
// -------------------------------------------------------------------

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

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Extract variation value from child name by comparing with parent name.
 * e.g. parent="REGATA FULL HEAVY PRETA", child="REGATA FULL HEAVY PRETA P" → "P"
 */
function extractVariationFromName(
  childName: string,
  parentName: string
): string {
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

function parseVariationType(tipoVariacao: string): string {
  return tipoVariacao.replace(/\s*tray\s*$/i, "").trim();
}

// -------------------------------------------------------------------
// Shared: fetch Eccosys parent + children
// -------------------------------------------------------------------

interface EccChild {
  id: number;
  sku: string;
  nome: string;
  estoque: number;
  atributos: Record<string, string>;
}

async function fetchEccosysFamily(
  parentSku: string,
  workspaceId: string
): Promise<{
  parent: { id: number; sku: string; nome: string; estoque: number };
  children: EccChild[];
} | null> {
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

  const parentEstoque = parent._Estoque?.estoqueDisponivel ?? 0;

  // Fetch children
  const childSkus = parent._Skus || [];
  const children: EccChild[] = [];

  // Parent attributes for variation type detection
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
        } catch {
          /* continue with 0 */
        }
      }

      const atributos: Record<string, string> = {};
      if (Array.isArray(child._Atributos)) {
        for (const a of child._Atributos) {
          if (a.descricao && a.valor) atributos[a.descricao] = a.valor;
        }
      }

      children.push({
        id: child.id,
        sku: child.codigo,
        nome: child.nome,
        estoque,
        atributos,
      });
    } catch {
      /* skip */
    }
  }

  // Inject variation attribute from name diff (same as import-family)
  const tipoVariacao =
    parentAtributos["Tipo da Variação"] ||
    parentAtributos["Tipo da Variacao"];
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
// Matching algorithm
// -------------------------------------------------------------------

interface Match {
  ml_id: string;
  ml_sku: string;
  ecc_id: number;
  ecc_sku: string;
  matched_by: string;
}

function matchVariations(
  mlChildren: HubProduct[],
  eccChildren: EccChild[]
): { matches: Match[]; unmatched_ml: string[]; unmatched_ecc: string[] } {
  const matches: Match[] = [];
  const usedEcc = new Set<string>();
  const unmatchedMl: string[] = [];

  // Direct 1:1 match if only one of each
  if (mlChildren.length === 1 && eccChildren.length === 1) {
    matches.push({
      ml_id: mlChildren[0].id,
      ml_sku: mlChildren[0].sku,
      ecc_id: eccChildren[0].id,
      ecc_sku: eccChildren[0].sku,
      matched_by: "direct_1to1",
    });
    return { matches, unmatched_ml: [], unmatched_ecc: [] };
  }

  for (const mlChild of mlChildren) {
    const mlAttrs = mlChild.atributos || {};
    let bestMatch: { ecc: EccChild; score: number; reason: string } | null =
      null;

    for (const eccChild of eccChildren) {
      if (usedEcc.has(eccChild.sku)) continue;

      let score = 0;
      const reasons: string[] = [];

      // Compare through the attribute map
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

      // Also try matching values directly (any ML attr value matches any Eccosys attr value)
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

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { ecc: eccChild, score, reason: reasons.join(", ") };
      }
    }

    if (bestMatch) {
      matches.push({
        ml_id: mlChild.id,
        ml_sku: mlChild.sku,
        ecc_id: bestMatch.ecc.id,
        ecc_sku: bestMatch.ecc.sku,
        matched_by: bestMatch.reason,
      });
      usedEcc.add(bestMatch.ecc.sku);
    } else {
      unmatchedMl.push(mlChild.sku);
    }
  }

  const unmatchedEcc = eccChildren
    .filter((e) => !usedEcc.has(e.sku))
    .map((e) => e.sku);

  return { matches, unmatched_ml: unmatchedMl, unmatched_ecc: unmatchedEcc };
}

// -------------------------------------------------------------------
// GET — Preview matching before linking
// -------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspace_id required" },
      { status: 401 }
    );
  }

  const eccParentSku = req.nextUrl.searchParams.get("ecc_parent_sku")?.trim();
  const mlItemId = req.nextUrl.searchParams.get("ml_item_id")?.trim();

  if (!eccParentSku || !mlItemId) {
    return NextResponse.json(
      { error: "ecc_parent_sku and ml_item_id required" },
      { status: 400 }
    );
  }

  // 1. Fetch Eccosys family
  const family = await fetchEccosysFamily(eccParentSku, workspaceId);
  if (!family) {
    return NextResponse.json(
      {
        error: `Produto pai "${eccParentSku}" nao encontrado no Eccosys. Verifique o codigo.`,
      },
      { status: 404 }
    );
  }

  // 2. Fetch ML hub rows
  const supabase = createAdminClient();
  const { data: mlRows } = await supabase
    .from("hub_products")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("ml_item_id", mlItemId);

  if (!mlRows || mlRows.length === 0) {
    return NextResponse.json(
      { error: `Anuncio ML "${mlItemId}" nao encontrado no Hub.` },
      { status: 404 }
    );
  }

  const mlParent = (mlRows as HubProduct[]).find(
    (r) => !r.ml_variation_id
  );
  const mlChildren = (mlRows as HubProduct[]).filter(
    (r) => !!r.ml_variation_id
  );

  // 3. Match
  const { matches, unmatched_ml, unmatched_ecc } = matchVariations(
    mlChildren,
    family.children
  );

  return NextResponse.json({
    ecc_parent: family.parent,
    ecc_children: family.children.map((c) => ({
      id: c.id,
      sku: c.sku,
      nome: c.nome,
      estoque: c.estoque,
      atributos: c.atributos,
    })),
    ml_parent: mlParent
      ? { id: mlParent.id, sku: mlParent.sku, nome: mlParent.nome }
      : null,
    ml_children: mlChildren.map((c) => ({
      id: c.id,
      sku: c.sku,
      nome: c.nome,
      ml_variation_id: c.ml_variation_id,
      atributos: c.atributos,
    })),
    matches,
    unmatched_ml,
    unmatched_ecc,
  });
}

// -------------------------------------------------------------------
// POST — Execute the linking
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
  const { ml_item_id, ecc_parent_sku } = body as {
    ml_item_id: string;
    ecc_parent_sku: string;
  };

  if (!ml_item_id || !ecc_parent_sku) {
    return NextResponse.json(
      { error: "ml_item_id and ecc_parent_sku required" },
      { status: 400 }
    );
  }

  // 1. Fetch Eccosys family
  const family = await fetchEccosysFamily(ecc_parent_sku, workspaceId);
  if (!family) {
    return NextResponse.json(
      { error: `Produto pai "${ecc_parent_sku}" nao encontrado no Eccosys.` },
      { status: 404 }
    );
  }

  // 2. Fetch ML hub rows
  const supabase = createAdminClient();
  const { data: mlRows, error: mlErr } = await supabase
    .from("hub_products")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("ml_item_id", ml_item_id);

  if (mlErr || !mlRows || mlRows.length === 0) {
    return NextResponse.json(
      { error: `Anuncio ML "${ml_item_id}" nao encontrado no Hub.` },
      { status: 404 }
    );
  }

  const mlParent = (mlRows as HubProduct[]).find((r) => !r.ml_variation_id);
  const mlChildren = (mlRows as HubProduct[]).filter(
    (r) => !!r.ml_variation_id
  );

  // 3. Match children
  const { matches } = matchVariations(mlChildren, family.children);

  // Build lookup: ecc_sku → ecc child data
  const eccMap = new Map(family.children.map((c) => [c.sku, c]));

  // 4. Check which Eccosys SKUs are already taken by OTHER ML items
  //    (supports same Eccosys product → multiple ML listings, e.g. classic + premium)
  const targetSkus = [
    family.parent.sku,
    ...matches.map((m) => m.ecc_sku),
  ];
  const { data: existingMlRows } = await supabase
    .from("hub_products")
    .select("sku")
    .eq("workspace_id", workspaceId)
    .in("sku", targetSkus)
    .neq("ml_item_id", ml_item_id);

  const takenSkus = new Set(existingMlRows?.map((r) => r.sku) || []);

  // Delete conflicting Eccosys-source rows (only for SKUs not taken by other ML items)
  const freeSkus = targetSkus.filter((s) => !takenSkus.has(s));
  if (freeSkus.length > 0) {
    await supabase
      .from("hub_products")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("source", "eccosys")
      .in("sku", freeSkus);
  }

  const now = new Date().toISOString();
  let linked = 0;
  const skuKept = takenSkus.size > 0;

  // 5. Update ML parent row
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
        last_ecc_sync: now,
        updated_at: now,
      })
      .eq("id", mlParent.id);
    linked++;
  }

  // 6. Update each matched ML child row
  for (const match of matches) {
    const eccChild = eccMap.get(match.ecc_sku);
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
        last_ecc_sync: now,
        updated_at: now,
      })
      .eq("id", match.ml_id);
    linked++;
  }

  // 7. Log
  await supabase.from("hub_logs").insert({
    workspace_id: workspaceId,
    action: "link_eccosys",
    entity: "product",
    entity_id: ml_item_id,
    direction: "ml_to_eccosys",
    status: "ok",
    details: {
      ecc_parent_sku: family.parent.sku,
      ml_item_id: ml_item_id,
      linked,
      matches: matches.length,
      sku_kept: skuKept,
      taken_skus: takenSkus.size > 0 ? [...takenSkus] : undefined,
      children_matched: matches.map((m) => ({
        ml_sku: m.ml_sku,
        ecc_sku: m.ecc_sku,
        matched_by: m.matched_by,
      })),
    },
  });

  return NextResponse.json({
    linked,
    parent_sku: family.parent.sku,
    children_matched: matches,
  });
}
