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
    // Capture errors per-endpoint so the drawer can show what failed
    // (Locaweb may surface 404 if the endpoint name differs in their account
    // or 403 if scopes don't allow listing).
    const senders = await listSenders(creds).catch((err) => ({
      _error: (err as { message?: string }).message ?? "senders endpoint failed",
    }));
    const domains = await listDomains(creds).catch((err) => ({
      _error: (err as { message?: string }).message ?? "domains endpoint failed",
    }));
    return NextResponse.json({
      senders: Array.isArray(senders) ? senders : [],
      domains: Array.isArray(domains) ? domains : [],
      senders_error:
        Array.isArray(senders) ? null : (senders as { _error: string })._error,
      domains_error:
        Array.isArray(domains) ? null : (domains as { _error: string })._error,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
