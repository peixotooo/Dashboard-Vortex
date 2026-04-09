import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { downloadFile } from "@/lib/b2-storage";
import { analyzeProductImage, resolveTemplate } from "@/lib/pre-cadastro/openai-analyzer";
import type { TemplateData, CategoryNode } from "@/lib/pre-cadastro/types";

export const maxDuration = 60;

/** Normalize template_data to always be an array */
function getTemplatePool(raw: unknown): TemplateData[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as TemplateData[];
  return [raw as TemplateData];
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  // Fetch item + collection data
  const { data: item } = await supabase
    .from("collection_items")
    .select("*, product_collections!collection_id(*)")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!item) {
    return NextResponse.json({ error: "Item nao encontrado" }, { status: 404 });
  }

  const collection = (item as Record<string, unknown>).product_collections as Record<string, unknown>;
  const templates = getTemplatePool(collection.template_data);

  try {
    // Download image from B2
    const imageBuffer = await downloadFile(item.image_storage_key);
    const base64 = Buffer.from(imageBuffer).toString("base64");

    // Determine mime type from filename
    const ext = item.original_filename.split(".").pop()?.toLowerCase() || "jpg";
    const mimeMap: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
    const mimeType = mimeMap[ext] || "image/jpeg";

    const result = await analyzeProductImage(
      base64,
      mimeType,
      item.original_filename,
      collection.context_description as string | null,
      templates,
      collection.categories_snapshot as CategoryNode[] | null
    );

    // Resolve chosen template
    const chosenTemplate = resolveTemplate(result, templates);

    // Derive name from filename as the source of truth
    const filenameBase = item.original_filename
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]/g, " ")
      .toUpperCase()
      .trim();

    // Update item with new AI results — filename-derived name takes priority
    const updates: Record<string, unknown> = {
      nome: filenameBase || result.nome,
      codigo: result.url_slug || item.original_filename.replace(/\.[^.]+$/, "").toLowerCase(),
      descricao_ecommerce: result.descricao_ecommerce,
      descricao_complementar: result.descricao_complementar || null,
      descricao_detalhada: result.descricao_detalhada || null,
      keywords: result.keywords || null,
      metatag_description: result.metatag_description || null,
      titulo_pagina: result.titulo_pagina || null,
      url_slug: result.url_slug || null,
      composicao: result.composicao || null,
      departamento_id: result.departamento?.id || null,
      departamento_nome: result.departamento?.nome || null,
      categoria_id: result.categoria?.id || null,
      categoria_nome: result.categoria?.nome || null,
      subcategoria_id: result.subcategoria?.id || null,
      subcategoria_nome: result.subcategoria?.nome || null,
      ai_raw_response: result,
      ai_confidence: result.confidence,
      ai_model: "openai/gpt-4o-mini",
      ai_processed_at: new Date().toISOString(),
      status: "ready",
      error_msg: null,
      user_edits: {},
      updated_at: new Date().toISOString(),
    };

    // Apply template or defaults for fiscal/operational fields
    updates.ncm = chosenTemplate?.cf || "6105.20.00";
    updates.unidade = chosenTemplate?.unidade || "Un";
    updates.origem = chosenTemplate?.origem || "0";
    updates.id_fornecedor = chosenTemplate?.idFornecedor || "0";
    updates.peso = chosenTemplate?.peso ? parseFloat(chosenTemplate.peso) : 0.220;
    updates.largura = chosenTemplate?.largura ? parseFloat(chosenTemplate.largura) : 25;
    updates.altura = chosenTemplate?.altura ? parseFloat(chosenTemplate.altura) : 3;
    updates.comprimento = chosenTemplate?.comprimento ? parseFloat(chosenTemplate.comprimento) : 30;
    updates.fabricante = "BULKING INDUSTRIA E COMERCIO DE ROUPAS LTDA.";

    const { data: updated, error } = await supabase
      .from("collection_items")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Erro desconhecido";

    await supabase
      .from("collection_items")
      .update({ status: "error", error_msg: errorMsg, updated_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
