import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { syncSingleProduct } from "@/lib/shelves/catalog-sync";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json(
      { error: "Missing token parameter" },
      { status: 401 }
    );
  }

  const admin = createAdminClient();

  // Look up workspace by webhook token
  const { data: connection, error: connError } = await admin
    .from("vnda_connections")
    .select("workspace_id, store_host")
    .eq("webhook_token", token)
    .limit(1)
    .single();

  if (connError || !connection?.workspace_id) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const workspaceId = connection.workspace_id as string;
  const storeHost = connection.store_host as string;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    await syncSingleProduct(
      workspaceId,
      payload as Parameters<typeof syncSingleProduct>[1],
      storeHost
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[VNDA Product Webhook]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
