import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();

  const supabase = createAdminClient();

  // Get current item to track user_edits
  const { data: current } = await supabase
    .from("collection_items")
    .select("user_edits")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!current) {
    return NextResponse.json({ error: "Item nao encontrado" }, { status: 404 });
  }

  // Track which fields were manually edited
  const editableFields = [
    "nome", "codigo", "descricao_ecommerce", "descricao_complementar",
    "descricao_detalhada", "preco", "preco_custo", "peso",
    "largura", "altura", "comprimento", "gtin",
    "ncm", "unidade", "origem", "id_fornecedor",
    "keywords", "metatag_description", "titulo_pagina", "url_slug",
    "composicao", "fabricante",
    "departamento_id", "categoria_id", "subcategoria_id",
    "departamento_nome", "categoria_nome", "subcategoria_nome",
  ];

  const updates: Record<string, unknown> = {};
  const userEdits = { ...((current.user_edits as Record<string, unknown>) || {}) };

  for (const field of editableFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
      userEdits[field] = true;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 });
  }

  updates.user_edits = userEdits;
  updates.status = "edited";
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("collection_items")
    .update(updates)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  // Get collection_id before deleting
  const { data: item } = await supabase
    .from("collection_items")
    .select("collection_id")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!item) {
    return NextResponse.json({ error: "Item nao encontrado" }, { status: 404 });
  }

  const { error } = await supabase
    .from("collection_items")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update total_items count
  const { count } = await supabase
    .from("collection_items")
    .select("id", { count: "exact", head: true })
    .eq("collection_id", item.collection_id);

  await supabase
    .from("product_collections")
    .update({ total_items: count || 0, updated_at: new Date().toISOString() })
    .eq("id", item.collection_id);

  return NextResponse.json({ ok: true });
}
