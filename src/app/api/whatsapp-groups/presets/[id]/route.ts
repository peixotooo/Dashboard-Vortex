import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { id } = await params;
    const body = await request.json();
    const { name, group_jids } = body as {
      name?: string;
      group_jids?: string[];
    };

    const admin = createAdminClient();
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (name) updates.name = name;
    if (group_jids) updates.group_jids = group_jids;

    const { error } = await admin
      .from("wapi_group_presets")
      .update(updates)
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { id } = await params;
    const admin = createAdminClient();
    const { error } = await admin
      .from("wapi_group_presets")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleAuthError(error);
  }
}
