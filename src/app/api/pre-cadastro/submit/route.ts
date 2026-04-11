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

  // All size attributes with their option IDs per size
  const SIZE_ATTRS: { attrId: number; options: Record<string, string> }[] = [
    { // Tamanho
      attrId: 1707971035,
      options: { P: "1707971037", M: "1707971040", G: "1707971056", GG: "1707971072", XGG: "1707971084" },
    },
    { // Tamanho Camiseta
      attrId: 1294111292,
      options: { P: "1294111296", M: "1294111299", G: "1294111304", GG: "1294111308", XGG: "1294111312" },
    },
    { // Tamanho Any
      attrId: 1731184002,
      options: { P: "1731184035", M: "1731184032", G: "1731184029", GG: "1731184026", XGG: "1731184014" },
    },
    { // Tamanho Tray
      attrId: 1294111700,
      options: { P: "1294111701", M: "1294111702", G: "1294111703", GG: "1294111704" },
    },
  ];

  const results: { id: string; status: string; ecc_product_id?: number; children?: number; error?: string }[] = [];
  let submitted = 0;
  let errors = 0;

  for (const item of items as CollectionItem[]) {
    try {
      // Validate required fields
      if (!item.preco || item.preco <= 0) {
        throw new Error("Preco de venda e obrigatorio. Preencha antes de enviar.");
      }

      // Resolve template for this item
      const chosenTemplate = resolveTemplate(
        { nome: item.nome || "", departamento: null, categoria: item.categoria_id ? { id: item.categoria_id, nome: item.categoria_nome || "" } : null, subcategoria: null, descricao_ecommerce: "", descricao_complementar: "", descricao_detalhada: "", keywords: "", metatag_description: "", titulo_pagina: "", url_slug: "", composicao: "", atributos_detectados: {}, confidence: {} },
        templates
      );

      // Build product body with category as department tag
      const parentBody = mapItemToEccosys(item, chosenTemplate);
      // Eccosys departments are flat (Camiseta, Bermuda, etc.)
      // Only use departamento_id if it's a real Eccosys ID (6+ digits), not a generic AI ID like "1"
      const deptId = item.departamento_id || "";
      if (deptId.length >= 6) {
        parentBody.idTagDepartamentoArvore = deptId;
      }
      console.log(`[pre-cadastro] dept=${deptId} (${deptId.length >= 6 ? "valid" : "skipped"})`);

      let parentEccId: number | null = item.ecc_product_id || null;
      let parentCodigo = item.codigo || "";
      const isUpdate = !!parentEccId;

      if (isUpdate) {
        // UPDATE existing product via PUT
        parentBody.id = String(parentEccId);
        parentBody.codigo = parentCodigo;
        const updated = await eccosys.put<unknown>("/produtos", parentBody);
        console.log(`[pre-cadastro] PUT /produtos ${parentCodigo}:`, JSON.stringify(updated));
      } else {
        // CREATE new product via POST
        parentCodigo = String(nextSku++);
        parentBody.codigo = parentCodigo;
        console.log(`[pre-cadastro] POST /produtos ${parentCodigo}`);
        const created = await eccosys.post<unknown>("/produtos", parentBody);

        // Parse response to get the new ID
        if (typeof created === "number") {
          parentEccId = created;
        } else if (typeof created === "string") {
          parentEccId = parseInt(created, 10) || null;
        } else if (created && typeof created === "object") {
          const obj = created as Record<string, unknown>;
          if (obj.id) parentEccId = Number(obj.id) || null;
          const result = obj.result as Record<string, unknown> | undefined;
          if (result) {
            const success = result.success as unknown[] | undefined;
            if (success && Array.isArray(success) && success.length > 0) {
              parentEccId = Number((success[0] as Record<string, unknown>).id) || null;
            }
            const errs = result.error as unknown[] | undefined;
            if (errs && Array.isArray(errs) && errs.length > 0 && !parentEccId) {
              throw new Error(`Eccosys: ${(errs[0] as Record<string, unknown>).erro || "Erro"}`);
            }
          }
        }
        console.log(`[pre-cadastro] Created ${parentCodigo} → id=${parentEccId}`);
      }

      if (!parentEccId) {
        throw new Error("Eccosys nao retornou o ID do produto pai");
      }

      // Step 2: Upload all images to parent
      if (!isUpdate) {
        const allImages = (item.images as { public_url: string }[] | null) || [];
        const imageUrls = allImages.length > 0
          ? allImages.map((img) => img.public_url)
          : item.image_public_url ? [item.image_public_url] : [];

        for (const imgUrl of imageUrls) {
          try {
            await eccosys.postImage(parentEccId, imgUrl);
          } catch (imgErr) {
            console.warn(`[pre-cadastro] Erro imagem ${parentCodigo}:`, imgErr);
          }
        }
        if (imageUrls.length > 0) {
          console.log(`[pre-cadastro] ${imageUrls.length} images uploaded to ${parentCodigo}`);
        }
      }

      // Step 3: Category is set via idTagDepartamentoArvore in POST/PUT body above

      // Step 4: Create or update CHILDREN (size variations)
      let childrenCreated = 0;
      if (!isUpdate) {
        // Only create children for NEW products
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
            // Remove parent-only fields from child
            delete (childBody as Record<string, unknown>).id;

            const childResult = await eccosys.post<unknown>("/produtos", childBody);
            console.log(`[pre-cadastro] Child ${childCodigo} (${size}) created:`, JSON.stringify(childResult));

          // Step 4b: Set ALL size attributes via separate endpoint
          // POST /api/produtos/{codigo}/atributos?substituirTodosAtributos=N
          const attrPayload = SIZE_ATTRS
            .filter((a) => a.options[size])
            .map((a) => ({ id: a.attrId, valor: a.options[size] }));

          if (attrPayload.length > 0) {
            try {
              await eccosys.post(
                `/produtos/${childCodigo}/atributos?substituirTodosAtributos=N`,
                attrPayload
              );
              console.log(`[pre-cadastro] ${attrPayload.length} attrs set on ${childCodigo} = ${size}`);
            } catch (attrErr) {
              console.warn(`[pre-cadastro] Erro attrs on ${childCodigo}:`, attrErr);
            }
          }

          childrenCreated++;
        } catch (childErr) {
          console.warn(`[pre-cadastro] Erro ao criar filho ${childCodigo} (${size}):`, childErr);
        }
        }
      } else {
        // UPDATE existing children
        for (let i = 0; i < grade.length; i++) {
          const size = grade[i];
          const childCodigo = `${parentCodigo}-${i + 1}`;
          try {
            // Fetch child Eccosys ID by codigo
            const childProduct = await eccosys.get<Record<string, unknown>>(`/produtos/${childCodigo}`);
            const childData = Array.isArray(childProduct) ? childProduct[0] : childProduct;
            const childEccId = childData?.id;
            if (!childEccId) continue;

            // Update child with same fields as parent
            await eccosys.put("/produtos", {
              id: String(childEccId),
              nome: `${item.nome || ""} ${size}`,
              descricaoComplementar: parentBody.descricaoComplementar,
              descricaoEcommerce: parentBody.descricaoEcommerce,
              keyword: parentBody.keyword,
              metatagDescription: parentBody.metatagDescription,
              urlEcommerce: parentBody.urlEcommerce,
              tituloPagina: `${item.nome || ""} ${size}`,
              idFornecedor: parentBody.idFornecedor,
              idTagDepartamentoArvore: parentBody.idTagDepartamentoArvore || undefined,
              idTagMarcaArvore: parentBody.idTagMarcaArvore,
              cf: parentBody.cf,
              preco: parentBody.preco,
              precoCusto: parentBody.precoCusto,
            });
            console.log(`[pre-cadastro] Updated child ${childCodigo}`);
          } catch (childErr) {
            console.warn(`[pre-cadastro] Erro updating child ${childCodigo}:`, childErr);
          }
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
