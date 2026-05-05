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
import { renderTreeDraft } from "@/lib/email-templates/tree/render";
import { applyUtmTracking, buildCampaignSlug, sanitizeEmailHtml } from "@/lib/email-templates/tracking";
import type { Draft, BlockNode, DraftMeta } from "@/lib/email-templates/editor/schema";
import type { TreeDraft, SectionNode } from "@/lib/email-templates/tree/schema";

interface RuntimeMeta extends DraftMeta {
  engine?: "tree" | "blocks";
}

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
    const draft = data as Draft & { meta: RuntimeMeta };
    const url0 = new URL(req.url);
    const skipTracking = url0.searchParams.get("track") === "off";
    let html: string;
    if (draft.meta?.engine === "tree") {
      const tree: TreeDraft = {
        id: draft.id,
        workspace_id: draft.workspace_id,
        layout_id: draft.layout_id,
        name: draft.name,
        meta: {
          subject: draft.meta.subject,
          preview: draft.meta.preview,
          mode: draft.meta.mode,
        },
        sections: draft.blocks as unknown as SectionNode[],
        created_at: draft.created_at,
        updated_at: draft.updated_at,
      };
      html = await renderTreeDraft(tree);
    } else {
      html = renderDraft(draft);
    }
    // GET endpoint serves the user-facing copy/preview path. Stamp the same
    // utm_campaign as a future dispatch would, so manually-copied HTML
    // attributes correctly even before going through Locaweb. ?track=off
    // bails out for the thumbnail render in /drafts/page.tsx where UTMs
    // would just clutter the link inspector.
    if (!skipTracking) {
      html = applyUtmTracking(html, {
        campaign: buildCampaignSlug({ kind: "draft", source_id: draft.id }),
        id: draft.id,
      });
    }
    html = sanitizeEmailHtml(html);
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
    const url = new URL(req.url);
    const editorMode = url.searchParams.get("editor") === "1";
    const meta = body.meta as RuntimeMeta;

    let html: string;
    if (meta?.engine === "tree") {
      const tree: TreeDraft = {
        id,
        workspace_id: workspaceId,
        layout_id: layoutId ?? undefined,
        name: "",
        meta: { subject: meta.subject, preview: meta.preview, mode: meta.mode },
        sections: body.blocks as unknown as SectionNode[],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      html = await renderTreeDraft(tree, { editorMode });
    } else {
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
      html = renderDraft(draft, { editorMode });
    }
    return NextResponse.json({ html });
  } catch (err) {
    return handleAuthError(err);
  }
}
