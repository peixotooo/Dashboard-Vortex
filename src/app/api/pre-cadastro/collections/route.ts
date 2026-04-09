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

export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const { name, context_description, template_ecc_id } = body as {
    name?: string;
    context_description?: string;
    template_ecc_id?: number;
  };

  if (!name || !name.trim()) {
    return NextResponse.json({ error: "Nome da colecao e obrigatorio" }, { status: 400 });
  }

  // Fetch template product from Eccosys if provided
  let templateData: TemplateData | null = null;
  if (template_ecc_id) {
    try {
      const product = await eccosys.get<Record<string, unknown>>(`/produtos/${template_ecc_id}`);
      if (product) {
        templateData = {
          id: Number(product.id),
          nome: String(product.nome || ""),
          codigo: String(product.codigo || ""),
          cf: String(product.cf || ""),
          unidade: String(product.unidade || "un"),
          origem: String(product.origem || "0"),
          peso: String(product.peso || "0.00"),
          pesoLiq: String(product.pesoLiq || "0.00"),
          pesoBruto: String(product.pesoBruto || "0.00"),
          largura: String(product.largura || "0.00"),
          altura: String(product.altura || "0.00"),
          comprimento: String(product.comprimento || "0.00"),
          idFornecedor: String(product.idFornecedor || "0"),
          tipoProducao: String(product.tipoProducao || "T"),
          tipo: String(product.tipo || "P"),
          situacao: String(product.situacao || "A"),
          calcAutomEstoque: String(product.calcAutomEstoque || "S"),
          estoqueMinimo: String(product.estoqueMinimo || "0.00"),
          estoqueMaximo: String(product.estoqueMaximo || "0.00"),
        };
      }
    } catch (err) {
      console.error("[pre-cadastro] Erro ao buscar template:", err);
      return NextResponse.json(
        { error: `Erro ao buscar produto template: ${err instanceof Error ? err.message : "unknown"}` },
        { status: 400 }
      );
    }
  }

  // Fetch categories from Eccosys
  let categoriesSnapshot: CategoryNode[] | null = null;
  try {
    const depts = await eccosys.listAll<CategoryNode>("/departamentos");
    if (depts && depts.length > 0) {
      categoriesSnapshot = depts;
    }
  } catch (err) {
    console.warn("[pre-cadastro] Erro ao buscar categorias:", err);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("product_collections")
    .insert({
      workspace_id: workspaceId,
      name: name.trim(),
      context_description: context_description || null,
      template_ecc_id: template_ecc_id || null,
      template_data: templateData,
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
