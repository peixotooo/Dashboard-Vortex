import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import { mapItemToEccosys, buildCategorizationBody } from "@/lib/pre-cadastro/map-to-eccosys";
import { resolveTemplate } from "@/lib/pre-cadastro/openai-analyzer";
import { generateEAN14 } from "@/lib/pre-cadastro/ean14";
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

  // Generate unique SKU using timestamp to avoid collisions
  let nextSku = Math.floor(Date.now() / 1000) % 1000000000;
  console.log(`[pre-cadastro] Base SKU (timestamp): ${nextSku}`);

  // Size attribute IDs — extracted from Gladiator product (known good data)
  // These are the 3 key size attributes that must be filled on each child
  const KNOWN_SIZE_ATTRS = [
    { id: "1294111292", descricao: "Tamanho Camiseta" },
    { id: "1707971035", descricao: "Tamanho" },
    { id: "1731184002", descricao: "Tamanho Any" },
  ];

  // Also try to fetch additional size attributes dynamically
  let sizeAttrIds = [...KNOWN_SIZE_ATTRS];
  try {
    const allAttrs = await eccosys.get<{ id: string; descricao: string }[]>(
      "/atributos", undefined, { $offset: "0", $count: "500" }
    );
    const knownIds = new Set(KNOWN_SIZE_ATTRS.map((a) => a.id));
    const extra = (allAttrs || []).filter(
      (a) => a.descricao && a.descricao.toLowerCase().includes("tamanho") && !knownIds.has(a.id)
    );
    if (extra.length > 0) {
      sizeAttrIds = [...sizeAttrIds, ...extra];
    }
    console.log(`[pre-cadastro] ${sizeAttrIds.length} size attributes (${KNOWN_SIZE_ATTRS.length} known + ${extra.length} extra)`);
  } catch (err) {
    console.warn("[pre-cadastro] Using known size attrs only:", err);
  }

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
      console.log(`[pre-cadastro] Categorization: dept=${item.departamento_id} cat=${item.categoria_id} sub=${item.subcategoria_id} body=${JSON.stringify(categorizationBody)}`);
      if (categorizationBody) {
        try {
          await eccosys.post(`/produtos/${parentEccId}/categorizacao`, categorizationBody);
          console.log(`[pre-cadastro] Categorization set on ${parentEccId}`);
        } catch (catErr) {
          console.warn(`[pre-cadastro] Erro ao categorizar produto pai ${parentEccId}:`, catErr);
        }
      }

      // Step 4: Create CHILDREN (size variations) with EAN-14
      let childrenCreated = 0;
      for (let i = 0; i < grade.length; i++) {
        const size = grade[i];
        const childCodigo = `${parentCodigo}-${i + 1}`;
        const ean = generateEAN14();

        try {
          const childBody = {
            ...parentBody,
            codigo: childCodigo,
            gtin: ean,
            gtinEmbalagem: ean,
            idProdutoPai: String(parentEccId),
            codigoPai: parentCodigo,
            idProdutoMaster: String(parentEccId),
            nome: `${item.nome || ""} ${size}`,
          };

          const childResult = await eccosys.post<unknown>("/produtos", childBody);
          console.log(`[pre-cadastro] Child ${childCodigo} (${size}) created:`, JSON.stringify(childResult));

          // Extract child Eccosys ID to set size attributes
          let childEccId: number | null = null;
          if (childResult && typeof childResult === "object") {
            const obj = childResult as Record<string, unknown>;
            if (obj.id) childEccId = Number(obj.id) || null;
            const result = obj.result as Record<string, unknown> | undefined;
            if (result?.success && Array.isArray(result.success) && result.success.length > 0) {
              childEccId = Number((result.success[0] as Record<string, unknown>).id) || null;
            }
          }

          // Set size attributes on child (Tamanho Camiseta, Tamanho, Tamanho Any)
          if (childEccId && sizeAttrIds.length > 0) {
            const attrPayload = sizeAttrIds.map((attr) => ({
              idAtributo: String(attr.id),
              valor: size,
            }));
            try {
              const attrRes = await eccosys.post(`/produtos/${childEccId}/atributos`, attrPayload);
              console.log(`[pre-cadastro] Attrs on ${childEccId}=${size}: ${JSON.stringify(attrRes)}`);
            } catch (attrErr) {
              console.warn(`[pre-cadastro] Erro attrs ${childEccId} (batch), tentando individual:`, attrErr);
              // Fallback: try one by one
              for (const attr of KNOWN_SIZE_ATTRS) {
                try {
                  await eccosys.post(`/produtos/${childEccId}/atributos`, { idAtributo: attr.id, valor: size });
                } catch { /* skip */ }
              }
            }
          }

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
