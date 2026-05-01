// src/app/api/crm/email-templates/layouts/route.ts
//
// Returns the full layout registry so the Layout Library page can list all
// available variations with their metadata.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { LAYOUT_IDS, LAYOUTS } from "@/lib/email-templates/layouts";

export async function GET(req: NextRequest) {
  try {
    await getWorkspaceContext(req);
    const layouts = LAYOUT_IDS.map((id) => {
      const def = LAYOUTS[id];
      return {
        id: def.id,
        pattern_name: def.pattern_name,
        reference_image: def.reference_image,
        mode: def.mode,
        slots: def.slots,
        product_count: def.product_count,
      };
    });
    return NextResponse.json({ layouts });
  } catch (err) {
    return handleAuthError(err);
  }
}
