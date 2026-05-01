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
import type { Slot } from "@/lib/email-templates/types";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await getWorkspaceContext(req);
    const { id } = await params;
    const layout = LAYOUTS[id as LayoutId];
    if (!layout) {
      return new Response("not found", { status: 404 });
    }

    const slotParam = new URL(req.url).searchParams.get("slot");
    const requested = slotParam ? (parseInt(slotParam, 10) as Slot) : layout.slots[0];
    const slot = layout.slots.includes(requested) ? requested : layout.slots[0];

    const html = layout.render(buildPreviewContext(slot));
    // Return as text/html so the iframe can srcDoc it directly via a fetch
    // and JSON.parse-friendly payload.
    return NextResponse.json({
      id: layout.id,
      slot,
      html,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
