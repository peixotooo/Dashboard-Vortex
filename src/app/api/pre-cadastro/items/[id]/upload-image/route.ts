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
    .select("ecc_product_id, image_public_url, images, codigo")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!item || !item.ecc_product_id) {
    return NextResponse.json({ error: "Produto nao encontrado ou nao enviado ao Eccosys" }, { status: 404 });
  }

  // Collect all image URLs
  const allImages = (item.images as { public_url: string }[] | null) || [];
  const imageUrls = allImages.length > 0
    ? allImages.map((img) => img.public_url)
    : item.image_public_url ? [item.image_public_url] : [];

  if (imageUrls.length === 0) {
    return NextResponse.json({ error: "Produto sem imagem" }, { status: 400 });
  }

  console.log(`[upload-image] ${item.codigo}: ${imageUrls.length} images to upload`);

  try {
    // Delete ALL existing images first to avoid duplicates
    try {
      await eccosys.delete(`/produtos/${item.ecc_product_id}/imagens`);
      console.log(`[upload-image] ${item.codigo}: existing images deleted`);
    } catch (delErr) {
      console.warn(`[upload-image] ${item.codigo}: delete images failed (may not have any):`, delErr);
    }

    let uploaded = 0;
    const errors: string[] = [];

    for (const url of imageUrls) {
      try {
        await eccosys.postImage(item.ecc_product_id, url);
        uploaded++;
        console.log(`[upload-image] ${item.codigo}: uploaded ${uploaded}/${imageUrls.length}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        errors.push(msg);
        console.warn(`[upload-image] ${item.codigo}: error on image ${uploaded + 1}:`, msg);
      }
    }

    return NextResponse.json({
      ok: uploaded > 0,
      codigo: item.codigo,
      uploaded,
      total: imageUrls.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao enviar imagem" },
      { status: 500 }
    );
  }
}
