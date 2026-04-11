import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";

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

  const { data: item } = await supabase
    .from("collection_items")
    .select("ecc_product_id, image_public_url, codigo")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!item || !item.ecc_product_id) {
    return NextResponse.json({ error: "Produto nao encontrado ou nao enviado ao Eccosys" }, { status: 404 });
  }

  if (!item.image_public_url) {
    return NextResponse.json({ error: "Produto sem imagem" }, { status: 400 });
  }

  try {
    // Delete existing images first to avoid duplicates
    try {
      await eccosys.delete(`/produtos/imagens/excluir?idProduto=${item.ecc_product_id}`);
    } catch {
      // Ignore if no images to delete
    }

    await eccosys.postImage(item.ecc_product_id, item.image_public_url);
    return NextResponse.json({ ok: true, codigo: item.codigo });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao enviar imagem" },
      { status: 500 }
    );
  }
}
