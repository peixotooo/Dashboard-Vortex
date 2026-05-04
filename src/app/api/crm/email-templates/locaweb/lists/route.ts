// src/app/api/crm/email-templates/locaweb/lists/route.ts
//
// GET → returns the workspace's Locaweb lists (id + name + count). Used by the
//       dispatch picker so the user chooses which list(s) the campaign goes to.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getLocawebSettings } from "@/lib/locaweb/settings";
import { listLists } from "@/lib/locaweb/email-marketing";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const s = await getLocawebSettings(workspaceId);
    if (!s.account_id || !s.token) {
      return NextResponse.json({ lists: [], reason: "not_configured" });
    }
    const lists = await listLists({
      base_url: s.base_url,
      account_id: s.account_id,
      token: s.token,
    });
    return NextResponse.json({ lists });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status) {
      return NextResponse.json(
        { error: e.message ?? "Locaweb error", status: e.status },
        { status: 502 }
      );
    }
    return handleAuthError(err);
  }
}
