// src/app/api/crm/email-templates/drafts/[id]/migrate-to-blocks/route.ts
//
// Drafts created during the brief template-mode window have `blocks: []`
// and rely on `meta.template_data` being rendered by the original layout's
// .render(). We've reverted to block-mode editing, so on first load such a
// draft would render as an empty email. This endpoint rebuilds the blocks
// from the stored layout_id + template_data so the editor opens with an
// editable structure.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { buildDraftFromLayout } from "@/lib/email-templates/editor/presets";
import type { Draft } from "@/lib/email-templates/editor/schema";
import type { Slot } from "@/lib/email-templates/types";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    const sb = createAdminClient();

    const { data: row, error } = await sb
      .from("email_template_drafts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

    const draft = row as Draft;
    const td = draft.meta?.template_data;
    if (!td || !draft.layout_id) {
      return NextResponse.json({ draft });
    }
    if (Array.isArray(draft.blocks) && draft.blocks.length > 0) {
      // Already has blocks; nothing to do.
      return NextResponse.json({ draft });
    }

    // Heuristic for slot: coupon present → slot 2; otherwise slot 1.
    const slot: Slot = td.coupon ? 2 : 1;
    const seed = buildDraftFromLayout({
      layoutId: draft.layout_id,
      slot,
      primary: td.product,
      related: td.related ?? [],
      workspace_id: workspaceId,
      coupon: td.coupon
        ? {
            code: td.coupon.code,
            discount_percent: td.coupon.discount_percent,
            expires_at: new Date(td.coupon.expires_at),
          }
        : undefined,
    });

    // Patch seeded blocks with stored copy.
    const patched = seed.blocks.map((b) => {
      if (b.type === "headline") return { ...b, text: td.copy.headline };
      if (b.type === "lead") return { ...b, text: td.copy.lead };
      if (b.type === "cta")
        return { ...b, text: td.copy.cta_text, url: td.copy.cta_url };
      return b;
    });

    const newMeta = { ...draft.meta, ...seed.meta };
    // Drop the deprecated template-mode fields from meta.
    delete (newMeta as Partial<typeof newMeta>).render_mode;
    delete (newMeta as Partial<typeof newMeta>).template_data;

    const { data: updated, error: upErr } = await sb
      .from("email_template_drafts")
      .update({
        meta: newMeta,
        blocks: patched,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .select()
      .single();
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    return NextResponse.json({ draft: updated });
  } catch (err) {
    return handleAuthError(err);
  }
}
