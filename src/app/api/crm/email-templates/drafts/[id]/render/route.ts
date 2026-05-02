// src/app/api/crm/email-templates/drafts/[id]/render/route.ts
//
// POST { meta, blocks } → returns the rendered HTML for live preview without
// having to persist the draft on every keystroke. The client sends the
// in-memory state; we return server-rendered HTML so the iframe stays in
// sync.
//
// GET → loads the persisted draft from Supabase and returns HTML. Used by
// the Meus templates page to render thumbnails per card.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { renderDraft } from "@/lib/email-templates/editor/render";
import type { Draft, BlockNode, DraftMeta } from "@/lib/email-templates/editor/schema";

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
    const draft = data as Draft;
    const html = renderDraft(draft);
    return NextResponse.json({ html });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    const body = (await req.json()) as {
      meta: DraftMeta;
      blocks: BlockNode[];
      layout_id?: string;
    };
    if (!body?.meta || !Array.isArray(body?.blocks)) {
      return NextResponse.json({ error: "meta + blocks required" }, { status: 400 });
    }
    // Look up layout_id in DB if the client didn't send it. Without this the
    // template-mode dispatch in renderDraft falls through to block rendering
    // because draft.layout_id ends up undefined — which is exactly the bug
    // that made every preview look like a generic classic skeleton.
    let layoutId: string | null = body.layout_id ?? null;
    if (!layoutId) {
      const sb = createAdminClient();
      const { data } = await sb
        .from("email_template_drafts")
        .select("layout_id")
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .maybeSingle();
      layoutId = (data?.layout_id as string | null) ?? null;
    }
    const draft: Draft = {
      id,
      workspace_id: workspaceId,
      layout_id: layoutId ?? undefined,
      name: "",
      meta: body.meta,
      blocks: body.blocks,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const url = new URL(req.url);
    const editorMode = url.searchParams.get("editor") === "1";
    const html = renderDraft(draft, { editorMode });
    return NextResponse.json({ html });
  } catch (err) {
    return handleAuthError(err);
  }
}
