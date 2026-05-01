// src/app/api/crm/email-templates/layouts/[id]/preview/route.ts
//
// Returns rendered HTML for a layout id using the preview fixture. Used by
// the Layout Library page's iframe srcdoc. Optional ?slot= query (1|2|3)
// chooses which slot context to render with — defaults to the first slot
// the layout supports.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { LAYOUTS } from "@/lib/email-templates/layouts";
import type { LayoutId } from "@/lib/email-templates/layouts/types";
import { buildPreviewContext } from "@/lib/email-templates/preview-fixture";
import { ensureHero } from "@/lib/email-templates/hero/generate";
import type { Slot } from "@/lib/email-templates/types";

export const maxDuration = 180;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    const layout = LAYOUTS[id as LayoutId];
    if (!layout) {
      return new Response("not found", { status: 404 });
    }

    const slotParam = new URL(req.url).searchParams.get("slot");
    const requested = slotParam ? (parseInt(slotParam, 10) as Slot) : layout.slots[0];
    const slot = layout.slots.includes(requested) ? requested : layout.slots[0];
    const useHero = new URL(req.url).searchParams.get("hero") !== "off";

    const ctx = buildPreviewContext(slot);

    // Generate (or read from cache) a hero image for the layout. ensureHero
    // returns null if KIE_API_KEY is missing or the call fails — preview just
    // falls back to the fixture product image.
    if (useHero) {
      try {
        const hero_url = await ensureHero({
          workspace_id: workspaceId,
          layout_id: layout.id,
          slot,
          product: ctx.product,
        });
        if (hero_url) ctx.hero_url = hero_url;
      } catch {
        // swallow — fall back to product image
      }
    }

    const html = layout.render(ctx);
    return NextResponse.json({
      id: layout.id,
      slot,
      html,
      hero_url: ctx.hero_url ?? null,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
