import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import { mapItemToEccosys, buildCategorizationBody } from "@/lib/pre-cadastro/map-to-eccosys";
import type { CollectionItem, TemplateData } from "@/lib/pre-cadastro/types";

export const maxDuration = 300;

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

  // Fetch collection for template data
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

  const template = collection.template_data as TemplateData | null;
  const results: { id: string; status: string; ecc_product_id?: number; error?: string }[] = [];
  let submitted = 0;
  let errors = 0;

  for (const item of items as CollectionItem[]) {
    try {
      // Step 1: Create product in Eccosys
      const productBody = mapItemToEccosys(item, template);
      const created = await eccosys.post<{ id?: number }>("/produtos", productBody);
      const eccProductId = created?.id;

      if (!eccProductId) {
        throw new Error("Eccosys nao retornou o ID do produto criado");
      }

      // Step 2: Upload image
      try {
        await eccosys.postText(`/produtos/${eccProductId}/imagens`, item.image_public_url);
      } catch (imgErr) {
        console.warn(`[pre-cadastro] Erro ao enviar imagem para produto ${eccProductId}:`, imgErr);
        // Continue — product was created, image can be re-uploaded
      }

      // Step 3: Set categorization
      const categorizationBody = buildCategorizationBody(item);
      if (categorizationBody) {
        try {
          await eccosys.post(`/produtos/${eccProductId}/categorizacao`, categorizationBody);
        } catch (catErr) {
          console.warn(`[pre-cadastro] Erro ao categorizar produto ${eccProductId}:`, catErr);
          // Continue — product was created, categorization can be retried
        }
      }

      // Update item as submitted
      await supabase
        .from("collection_items")
        .update({
          status: "submitted",
          ecc_product_id: eccProductId,
          error_msg: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      submitted++;
      results.push({ id: item.id, status: "submitted", ecc_product_id: eccProductId });
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
    details: { submitted, errors, total: items.length },
  });

  return NextResponse.json({ submitted, errors, total: items.length, results });
}
