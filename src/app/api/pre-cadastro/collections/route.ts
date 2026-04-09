import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import type { TemplateData, CategoryNode } from "@/lib/pre-cadastro/types";

export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("product_collections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get item counts per collection
  const collectionIds = (data || []).map((c: { id: string }) => c.id);
  const { data: counts } = await supabase
    .from("collection_items")
    .select("collection_id, status")
    .in("collection_id", collectionIds.length > 0 ? collectionIds : ["__none__"]);

  const countMap = new Map<string, Record<string, number>>();
  for (const row of counts || []) {
    const r = row as { collection_id: string; status: string };
    if (!countMap.has(r.collection_id)) {
      countMap.set(r.collection_id, { pending: 0, processing: 0, ready: 0, edited: 0, submitted: 0, error: 0 });
    }
    const m = countMap.get(r.collection_id)!;
    m[r.status] = (m[r.status] || 0) + 1;
  }

  const collections = (data || []).map((c: Record<string, unknown>) => {
    const m = countMap.get(c.id as string) || {};
    return {
      ...c,
      items_pending: (m as Record<string, number>).pending || 0,
      items_ready: ((m as Record<string, number>).ready || 0) + ((m as Record<string, number>).edited || 0),
      items_submitted: (m as Record<string, number>).submitted || 0,
      items_error: (m as Record<string, number>).error || 0,
    };
  });

  return NextResponse.json(collections);
}

/**
 * Converts a raw Eccosys product to a TemplateData snapshot.
 */
function productToTemplate(p: Record<string, unknown>, deptName: string, catName: string): TemplateData {
  return {
    id: Number(p.id),
    nome: String(p.nome || ""),
    codigo: String(p.codigo || ""),
    cf: String(p.cf || ""),
    unidade: String(p.unidade || "un"),
    origem: String(p.origem || "0"),
    peso: String(p.peso || "0.00"),
    pesoLiq: String(p.pesoLiq || "0.00"),
    pesoBruto: String(p.pesoBruto || "0.00"),
    largura: String(p.largura || "0.00"),
    altura: String(p.altura || "0.00"),
    comprimento: String(p.comprimento || "0.00"),
    idFornecedor: String(p.idFornecedor || "0"),
    tipoProducao: String(p.tipoProducao || "T"),
    tipo: String(p.tipo || "P"),
    situacao: String(p.situacao || "A"),
    calcAutomEstoque: String(p.calcAutomEstoque || "S"),
    estoqueMinimo: String(p.estoqueMinimo || "0.00"),
    estoqueMaximo: String(p.estoqueMaximo || "0.00"),
    departamento: deptName,
    categoria: catName,
  };
}

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const { name, context_description } = body as {
    name?: string;
    context_description?: string;
  };

  if (!name || !name.trim()) {
    return NextResponse.json({ error: "Nome da colecao e obrigatorio" }, { status: 400 });
  }

  // 1. Fetch categories from Eccosys
  let categoriesSnapshot: CategoryNode[] | null = null;
  try {
    const depts = await eccosys.listAll<CategoryNode>("/departamentos");
    if (depts && depts.length > 0) {
      categoriesSnapshot = depts;
    }
  } catch (err) {
    console.warn("[pre-cadastro] Erro ao buscar categorias:", err);
  }

  // 2. Build category ID → name lookup from the tree
  const catIdToNames = new Map<string, { dept: string; cat: string }>();
  if (categoriesSnapshot) {
    for (const dept of categoriesSnapshot) {
      if (dept.categorias) {
        for (const cat of dept.categorias) {
          catIdToNames.set(String(cat.id), { dept: String(dept.nome), cat: String(cat.nome) });
        }
      }
    }
  }

  // 3. Auto-fetch template pool: 1 product per category (only parent products)
  let templatePool: TemplateData[] = [];
  try {
    // Fetch only parent products — much smaller set than all products
    const parents = await eccosys.get<Record<string, unknown>[]>(
      "/produtos/produtosPai",
      undefined,
      { $offset: "0", $count: "100", $situacao: "A" }
    );

    // Group by category, pick one per category (prefer products with NCM filled)
    const byCat = new Map<string, Record<string, unknown>>();
    for (const p of parents || []) {
      const catId = String(p.idCatProd || p.idSubCatProd || "0");
      if (catId === "0") continue;
      const existing = byCat.get(catId);
      if (!existing || (!existing.cf && p.cf)) {
        byCat.set(catId, p);
      }
    }

    for (const [catId, product] of byCat) {
      const names = catIdToNames.get(catId) || { dept: "", cat: "" };
      templatePool.push(productToTemplate(product, names.dept, names.cat));
    }

    console.log(`[pre-cadastro] ${templatePool.length} templates from ${(parents || []).length} parent products`);
  } catch (err) {
    console.warn("[pre-cadastro] Erro ao montar pool de templates:", err);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("product_collections")
    .insert({
      workspace_id: workspaceId,
      name: name.trim(),
      context_description: context_description || null,
      template_ecc_id: null,
      template_data: templatePool.length > 0 ? templatePool : null,
      categories_snapshot: categoriesSnapshot,
      status: "draft",
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Ja existe uma colecao com esse nome" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
