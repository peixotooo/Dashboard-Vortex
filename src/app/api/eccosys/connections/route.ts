import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { encrypt } from "@/lib/encryption";

export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("eccosys_connections")
    .select("id, workspace_id, ambiente, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .single();

  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const body = await req.json();
  const { api_token, ambiente } = body;

  if (!api_token || !ambiente) {
    return NextResponse.json(
      { error: "api_token e ambiente sao obrigatorios" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("eccosys_connections")
    .upsert(
      {
        workspace_id: workspaceId,
        api_token: encrypt(api_token),
        ambiente: ambiente.trim(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    )
    .select("id, workspace_id, ambiente, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const supabase = createAdminClient();
  await supabase
    .from("eccosys_connections")
    .delete()
    .eq("workspace_id", workspaceId);

  return NextResponse.json({ ok: true });
}
