// src/app/api/crm/email-templates/drafts/[id]/route.ts
//
// GET    → return the full draft (id, meta, blocks)
// PATCH  → save updates (name, meta, blocks)
// DELETE → drop the draft

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    const sb = createAdminClient();
    const { data, error } = await sb
      .from("email_template_drafts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ draft: data });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    const body = (await req.json()) as Partial<{
      name: string;
      meta: unknown;
      blocks: unknown[];
    }>;
    const sb = createAdminClient();

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === "string") update.name = body.name;
    if (body.meta) update.meta = body.meta;
    if (Array.isArray(body.blocks)) update.blocks = body.blocks;

    const { data, error } = await sb
      .from("email_template_drafts")
      .update(update)
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ draft: data });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    const sb = createAdminClient();
    const { error } = await sb
      .from("email_template_drafts")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleAuthError(err);
  }
}
