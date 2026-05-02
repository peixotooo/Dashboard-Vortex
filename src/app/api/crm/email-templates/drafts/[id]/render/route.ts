// src/app/api/crm/email-templates/drafts/[id]/render/route.ts
//
// POST { meta, blocks } → returns the rendered HTML for live preview without
// having to persist the draft on every keystroke. The client sends the
// in-memory state; we return server-rendered HTML so the iframe stays in
// sync.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { renderDraft } from "@/lib/email-templates/editor/render";
import type { Draft, BlockNode, DraftMeta } from "@/lib/email-templates/editor/schema";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    const body = (await req.json()) as { meta: DraftMeta; blocks: BlockNode[] };
    if (!body?.meta || !Array.isArray(body?.blocks)) {
      return NextResponse.json({ error: "meta + blocks required" }, { status: 400 });
    }
    const draft: Draft = {
      id,
      workspace_id: workspaceId,
      name: "",
      meta: body.meta,
      blocks: body.blocks,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const html = renderDraft(draft);
    return NextResponse.json({ html });
  } catch (err) {
    return handleAuthError(err);
  }
}
