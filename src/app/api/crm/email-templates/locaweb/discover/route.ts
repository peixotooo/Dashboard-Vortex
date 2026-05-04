// src/app/api/crm/email-templates/locaweb/discover/route.ts
//
// GET → fetches available senders + domains for the workspace's Locaweb
// account. Used by the settings UI to populate the from-address and
// domain dropdowns instead of asking the user to type ids manually.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getLocawebSettings } from "@/lib/locaweb/settings";
import { listSenders, listDomains } from "@/lib/locaweb/email-marketing";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const s = await getLocawebSettings(workspaceId);
    if (!s.account_id || !s.token) {
      return NextResponse.json(
        { senders: [], domains: [], reason: "not_configured" },
        { status: 200 }
      );
    }
    const creds = {
      base_url: s.base_url,
      account_id: s.account_id,
      token: s.token,
    };
    const [senders, domains] = await Promise.all([
      listSenders(creds).catch(() => []),
      listDomains(creds).catch(() => []),
    ]);
    return NextResponse.json({ senders, domains });
  } catch (err) {
    return handleAuthError(err);
  }
}
