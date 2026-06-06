import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

const ALLOWED_STATUS = ["published", "pending", "rejected", "hidden"];

// Modera uma avaliação: muda status (publicar/ocultar/rejeitar) ou adiciona
// resposta da loja.
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const { id } = await ctx.params;
    const body = await request.json();

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.status !== undefined) {
      if (!ALLOWED_STATUS.includes(body.status)) {
        return NextResponse.json({ error: "status inválido" }, { status: 400 });
      }
      patch.status = body.status;
    }
    if (body.reply_body !== undefined) {
      patch.reply_body = body.reply_body || null;
      patch.reply_at = body.reply_body ? new Date().toISOString() : null;
    }
    if (body.title !== undefined) patch.title = body.title;
    if (body.body !== undefined) patch.body = body.body;

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("reviews")
      .update(patch)
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ review: data });
  } catch (e) {
    return handleAuthError(e);
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const { id } = await ctx.params;

    const admin = createAdminClient();
    const { error } = await admin
      .from("reviews")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleAuthError(e);
  }
}
