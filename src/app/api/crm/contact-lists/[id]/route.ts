import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError, AuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

// GET = read one list (with full contacts)
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();
    const { data: list, error } = await admin
      .from("crm_contact_lists")
      .select("*")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (error || !list) {
      return NextResponse.json({ error: "Lista não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ list });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH = rename / update description / set locaweb_list_id
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const { workspaceId } = await getWorkspaceContext(request);

    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (typeof body.name === "string") {
      const trimmed = body.name.trim();
      if (trimmed.length === 0) {
        return NextResponse.json({ error: "Nome não pode ser vazio" }, { status: 400 });
      }
      updates.name = trimmed;
    }
    if (Object.prototype.hasOwnProperty.call(body, "description")) {
      updates.description = typeof body.description === "string" ? body.description.trim() : null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "locaweb_list_id")) {
      updates.locaweb_list_id = typeof body.locaweb_list_id === "string" ? body.locaweb_list_id : null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nada pra atualizar." }, { status: 400 });
    }
    updates.updated_at = new Date().toISOString();

    const admin = createAdminClient();
    const { data: list, error } = await admin
      .from("crm_contact_lists")
      .update(updates)
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .select("id, name, description, total_count, phone_count, email_count, locaweb_list_id, created_at, updated_at")
      .single();

    if (error || !list) {
      return NextResponse.json({ error: "Lista não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ list });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE = delete the list
export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();
    const { error } = await admin
      .from("crm_contact_lists")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
