import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { downloadFile } from "@/lib/b2-storage";
import { analyzeProductImage, resolveTemplate } from "@/lib/pre-cadastro/openai-analyzer";
import type { TemplateData, CategoryNode } from "@/lib/pre-cadastro/types";

export const maxDuration = 120;

/** Normalize template_data to always be an array */
function getTemplatePool(raw: unknown): TemplateData[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as TemplateData[];
  return [raw as TemplateData];
}

export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const { collection_id, item_ids } = body as {
    collection_id: string;
    item_ids?: string[];
  };

  if (!collection_id) {
    return NextResponse.json({ error: "collection_id required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Fetch collection
  const { data: collection } = await supabase
    .from("product_collections")
    .select("*")
    .eq("id", collection_id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!collection) {
    return NextResponse.json({ error: "Colecao nao encontrada" }, { status: 404 });
  }

  // Fetch items to process
  let query = supabase
    .from("collection_items")
    .select("*")
    .eq("collection_id", collection_id)
    .eq("workspace_id", workspaceId);

  if (item_ids && item_ids.length > 0) {
    query = query.in("id", item_ids);
  } else {
    query = query.in("status", ["pending", "error"]);
  }

  const { data: items } = await query.order("created_at", { ascending: true });

  if (!items || items.length === 0) {
    return NextResponse.json({ error: "Nenhum item para processar" }, { status: 400 });
  }

  // Update collection status
  await supabase
    .from("product_collections")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", collection_id);

  const templates = getTemplatePool(collection.template_data);
  const categories = collection.categories_snapshot as CategoryNode[] | null;
  const contextDescription = collection.context_description as string | null;

  const results: { id: string; status: string; error?: string }[] = [];
  let processed = 0;
  let errors = 0;

  for (const item of items) {
    try {
      // Mark as processing
      await supabase
        .from("collection_items")
        .update({ status: "processing" })
        .eq("id", item.id);

      // Download image from B2
      const imageBuffer = await downloadFile(item.image_storage_key);
      const base64 = Buffer.from(imageBuffer).toString("base64");

      // Determine mime type
      const ext = item.original_filename.split(".").pop()?.toLowerCase() || "jpg";
      const mimeMap: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
      const mimeType = mimeMap[ext] || "image/jpeg";

      // Analyze with AI (passes full template pool)
      const result = await analyzeProductImage(
        base64,
        mimeType,
        item.original_filename,
        contextDescription,
        templates,
        categories
      );

      // Resolve which template to use for fiscal/operational fields
      const chosenTemplate = resolveTemplate(result, templates);

      // Build updates
      const updates: Record<string, unknown> = {
        nome: result.nome,
        codigo: result.url_slug || null,
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

      await supabase.from("collection_items").update(updates).eq("id", item.id);

      processed++;
      results.push({ id: item.id, status: "ready" });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Erro desconhecido";
      errors++;

      await supabase
        .from("collection_items")
        .update({ status: "error", error_msg: errorMsg, updated_at: new Date().toISOString() })
        .eq("id", item.id);

      results.push({ id: item.id, status: "error", error: errorMsg });
    }

    // Small delay between items to respect rate limits
    await new Promise((r) => setTimeout(r, 500));
  }

  // Update collection status
  await supabase
    .from("product_collections")
    .update({ status: "review", updated_at: new Date().toISOString() })
    .eq("id", collection_id);

  // Log
  await supabase.from("hub_logs").insert({
    workspace_id: workspaceId,
    action: "pre_cadastro_analyze",
    entity: "collection",
    entity_id: collection_id,
    direction: "internal",
    status: errors > 0 ? "partial" : "ok",
    details: { processed, errors, total: items.length, templates_count: templates.length },
  });

  return NextResponse.json({ processed, errors, total: items.length, results });
}
