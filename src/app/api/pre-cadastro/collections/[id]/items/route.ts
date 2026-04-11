import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("collection_items")
    .select("*")
    .eq("collection_id", id)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const { id: collectionId } = await params;
  const body = await req.json();
  // Support two formats:
  // 1. Single product with multiple images: {product_name, images: [{storage_key, public_url}]}
  // 2. Legacy: multiple items: {items: [{filename, storage_key, public_url}]}
  const { items, product_name, images } = body as {
    items?: { filename: string; storage_key: string; public_url: string }[];
    product_name?: string;
    images?: { storage_key: string; public_url: string }[];
  };

  const supabase = createAdminClient();

  // Verify collection exists
  const { data: collection } = await supabase
    .from("product_collections")
    .select("id")
    .eq("id", collectionId)
    .eq("workspace_id", workspaceId)
    .single();

  if (!collection) {
    return NextResponse.json({ error: "Colecao nao encontrada" }, { status: 404 });
  }

  let rows: Record<string, unknown>[];

  if (product_name && images && images.length > 0) {
    // New format: single product with multiple images
    const primary = images[0];
    const allImages = images.map((img, i) => ({
      storage_key: img.storage_key,
      public_url: img.public_url,
      is_primary: i === 0,
    }));

    rows = [{
      collection_id: collectionId,
      workspace_id: workspaceId,
      original_filename: product_name,
      image_storage_key: primary.storage_key,
      image_public_url: primary.public_url,
      images: allImages,
      status: "pending",
    }];
  } else if (items && items.length > 0) {
    // Legacy format: one item per image
    rows = items.map((item) => ({
      collection_id: collectionId,
      workspace_id: workspaceId,
      original_filename: item.filename,
      image_storage_key: item.storage_key,
      image_public_url: item.public_url,
      images: [{ storage_key: item.storage_key, public_url: item.public_url, is_primary: true }],
      status: "pending",
    }));
  } else {
    return NextResponse.json({ error: "Nenhum item enviado" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("collection_items")
    .insert(rows)
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update total_items count
  const { count } = await supabase
    .from("collection_items")
    .select("id", { count: "exact", head: true })
    .eq("collection_id", collectionId);

  await supabase
    .from("product_collections")
    .update({ total_items: count || 0, updated_at: new Date().toISOString() })
    .eq("id", collectionId);

  return NextResponse.json({ inserted: data?.length || 0, items: data }, { status: 201 });
}
