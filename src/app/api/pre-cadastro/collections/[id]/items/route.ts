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
  const { items } = body as {
    items: { filename: string; storage_key: string; public_url: string }[];
  };

  if (!items || items.length === 0) {
    return NextResponse.json({ error: "Nenhum item enviado" }, { status: 400 });
  }

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

  // Insert items
  const rows = items.map((item) => ({
    collection_id: collectionId,
    workspace_id: workspaceId,
    original_filename: item.filename,
    image_storage_key: item.storage_key,
    image_public_url: item.public_url,
    status: "pending",
  }));

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
