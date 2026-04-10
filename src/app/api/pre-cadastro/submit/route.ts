import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import { mapItemToEccosys, buildCategorizationBody } from "@/lib/pre-cadastro/map-to-eccosys";
import { resolveTemplate } from "@/lib/pre-cadastro/openai-analyzer";
import { generateEAN14, getNextSequential } from "@/lib/pre-cadastro/ean14";
import type { CollectionItem, TemplateData } from "@/lib/pre-cadastro/types";

export const maxDuration = 300;

const DEFAULT_GRADE = ["P", "M", "G", "GG", "XGG"];

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

  // Fetch items to submit
  let query = supabase
    .from("collection_items")
    .select("*")
    .eq("collection_id", collection_id)
    .eq("workspace_id", workspaceId);

  if (item_ids && item_ids.length > 0) {
    query = query.in("id", item_ids);
  } else {
    query = query.in("status", ["ready", "edited"]);
  }

  const { data: items } = await query.order("created_at", { ascending: true });

  if (!items || items.length === 0) {
    return NextResponse.json({ error: "Nenhum item pronto para envio" }, { status: 400 });
  }

  const templates = getTemplatePool(collection.template_data);
  const grade: string[] = (collection.grade as string[]) || DEFAULT_GRADE;

  // Fetch recent products from Eccosys to find the highest numeric SKU
  let lastSku = 0;
  try {
    // Get a batch of recent products to find the max codigo
    const existing = await eccosys.get<{ codigo?: string }[]>(
      "/produtos",
      undefined,
      { $offset: "0", $count: "50", $situacao: "A" }
    );
    for (const p of existing || []) {
      // SKU may have format "349873991" or "349873991-1" (child)
      const base = String(p.codigo || "").split("-")[0];
      const num = parseInt(base, 10);
      if (!isNaN(num) && num > lastSku) lastSku = num;
    }
    console.log(`[pre-cadastro] Last SKU from Eccosys: ${lastSku} (from ${(existing || []).length} products)`);
  } catch (err) {
    console.warn("[pre-cadastro] Erro ao buscar ultimo SKU:", err);
  }
  // Also check any SKUs already submitted in this workspace
  const { data: submittedItems } = await supabase
    .from("collection_items")
    .select("codigo")
    .eq("workspace_id", workspaceId)
    .eq("status", "submitted")
    .not("codigo", "is", null);
  for (const row of submittedItems || []) {
    const base = String((row as { codigo: string }).codigo).split("-")[0];
    const num = parseInt(base, 10);
    if (!isNaN(num) && num > lastSku) lastSku = num;
  }
  let nextSku = lastSku + 1;
  console.log(`[pre-cadastro] Next SKU will be: ${nextSku}`);

  // Get existing EANs to calculate next sequential
  const { data: existingGtins } = await supabase
    .from("collection_items")
    .select("gtin")
    .eq("workspace_id", workspaceId)
    .not("gtin", "is", null);
  const existingEans = (existingGtins || [])
    .map((r: { gtin: string | null }) => r.gtin)
    .filter((g): g is string => !!g);
  let nextEanSeq = getNextSequential(existingEans);

  const results: { id: string; status: string; ecc_product_id?: number; children?: number; error?: string }[] = [];
  let submitted = 0;
  let errors = 0;

  for (const item of items as CollectionItem[]) {
    try {
      // Resolve template for this item
      const chosenTemplate = resolveTemplate(
        { nome: item.nome || "", departamento: null, categoria: item.categoria_id ? { id: item.categoria_id, nome: item.categoria_nome || "" } : null, subcategoria: null, descricao_ecommerce: "", descricao_complementar: "", descricao_detalhada: "", keywords: "", metatag_description: "", titulo_pagina: "", url_slug: "", composicao: "", atributos_detectados: {}, confidence: {} },
        templates
      );

      // Step 1: Create PARENT product in Eccosys (no EAN, no variation)
      const parentCodigo = String(nextSku++);
      const parentBody = mapItemToEccosys(item, chosenTemplate);
      parentBody.codigo = parentCodigo;
      console.log(`[pre-cadastro] Sending to Eccosys:`, JSON.stringify({ codigo: parentBody.codigo, nome: parentBody.nome, cf: parentBody.cf, preco: parentBody.preco }));
      const created = await eccosys.post<unknown>("/produtos", parentBody);

      // Parse Eccosys response
      // Format: {"result":{"success":[{"id":"123"}],"error":[{"id":"","erro":"msg"}]}}
      let parentEccId: number | null = null;

      if (typeof created === "number") {
        parentEccId = created;
      } else if (typeof created === "string") {
        parentEccId = parseInt(created, 10) || null;
      } else if (created && typeof created === "object") {
        const obj = created as Record<string, unknown>;
        // Direct id field
        if (obj.id) {
          parentEccId = Number(obj.id) || null;
        }
        // Eccosys batch format: {result: {success: [{id}], error: [{erro}]}}
        const result = obj.result as Record<string, unknown> | undefined;
        if (result) {
          const success = result.success as unknown[] | undefined;
          if (success && Array.isArray(success) && success.length > 0) {
            parentEccId = Number((success[0] as Record<string, unknown>).id) || null;
          }
          // Errors inside result.error
          const errs = result.error as unknown[] | undefined;
          if (errs && Array.isArray(errs) && errs.length > 0 && !parentEccId) {
            const errMsg = (errs[0] as Record<string, unknown>).erro || "Erro desconhecido";
            throw new Error(`Eccosys: ${errMsg}`);
          }
        }
        // Also check top-level error array
        const topErrs = obj.error as unknown[] | undefined;
        if (topErrs && Array.isArray(topErrs) && topErrs.length > 0 && !parentEccId) {
          const errMsg = (topErrs[0] as Record<string, unknown>).erro || "Erro desconhecido";
          throw new Error(`Eccosys: ${errMsg}`);
        }
      }

      console.log(`[pre-cadastro] POST /produtos response:`, JSON.stringify(created), `→ id=${parentEccId}, codigo=${parentCodigo}`);

      if (!parentEccId) {
        throw new Error(`Eccosys nao retornou o ID do produto pai. Response: ${JSON.stringify(created)}`);
      }

      // Step 2: Upload image to parent
      try {
        await eccosys.postText(`/produtos/${parentEccId}/imagens`, item.image_public_url);
      } catch (imgErr) {
        console.warn(`[pre-cadastro] Erro ao enviar imagem para produto pai ${parentEccId}:`, imgErr);
      }

      // Step 3: Set categorization on parent
      const categorizationBody = buildCategorizationBody(item);
      if (categorizationBody) {
        try {
          await eccosys.post(`/produtos/${parentEccId}/categorizacao`, categorizationBody);
        } catch (catErr) {
          console.warn(`[pre-cadastro] Erro ao categorizar produto pai ${parentEccId}:`, catErr);
        }
      }

      // Step 4: Create CHILDREN (size variations) with EAN-14
      let childrenCreated = 0;
      for (let i = 0; i < grade.length; i++) {
        const size = grade[i];
        const childCodigo = `${parentCodigo}-${i + 1}`;
        const ean = generateEAN14(nextEanSeq++);

        try {
          const childBody = {
            ...parentBody,
            codigo: childCodigo,
            gtin: ean,
            idProdutoPai: parentEccId,
            codigoPai: parentCodigo,
            nome: `${item.nome || ""} ${size}`,
          };

          const childResult = await eccosys.post("/produtos", childBody);
          console.log(`[pre-cadastro] Child ${childCodigo} (${size}) created:`, JSON.stringify(childResult));
          childrenCreated++;
        } catch (childErr) {
          console.warn(`[pre-cadastro] Erro ao criar filho ${childCodigo} (${size}):`, childErr);
        }
      }

      // Update item as submitted
      await supabase
        .from("collection_items")
        .update({
          status: "submitted",
          ecc_product_id: parentEccId,
          codigo: parentCodigo,
          gtin: null, // parent has no EAN
          error_msg: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      submitted++;
      results.push({ id: item.id, status: "submitted", ecc_product_id: parentEccId, children: childrenCreated });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Erro desconhecido";
      errors++;

      await supabase
        .from("collection_items")
        .update({ status: "error", error_msg: errorMsg, updated_at: new Date().toISOString() })
        .eq("id", item.id);

      results.push({ id: item.id, status: "error", error: errorMsg });
    }
  }

  // Update collection counts
  const { count: submittedCount } = await supabase
    .from("collection_items")
    .select("id", { count: "exact", head: true })
    .eq("collection_id", collection_id)
    .eq("status", "submitted");

  await supabase
    .from("product_collections")
    .update({
      submitted_items: submittedCount || 0,
      status: submittedCount === collection.total_items ? "submitted" : "review",
      updated_at: new Date().toISOString(),
    })
    .eq("id", collection_id);

  // Log
  await supabase.from("hub_logs").insert({
    workspace_id: workspaceId,
    action: "pre_cadastro_submit",
    entity: "collection",
    entity_id: collection_id,
    direction: "hub_to_eccosys",
    status: errors > 0 ? "partial" : "ok",
    details: { submitted, errors, total: items.length, grade },
  });

  return NextResponse.json({ submitted, errors, total: items.length, results });
}
