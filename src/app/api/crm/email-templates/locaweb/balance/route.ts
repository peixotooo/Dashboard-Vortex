// src/app/api/crm/email-templates/locaweb/balance/route.ts
//
// Returns the workspace's Locaweb sending credits so the dispatch dialogs
// can cross-reference balance vs estimated audience size before firing.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getReadyCreds } from "@/lib/locaweb/settings";
import { getAccountBalance } from "@/lib/locaweb/email-marketing";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    let creds;
    try {
      creds = await getReadyCreds(workspaceId);
    } catch (err) {
      return NextResponse.json(
        { configured: false, error: (err as Error).message },
        { status: 200 }
      );
    }
    try {
      const balance = await getAccountBalance(creds.creds);
      return NextResponse.json({
        configured: true,
        total: balance.total ?? null,
        used: balance.used ?? null,
        remaining: balance.remaining ?? null,
      });
    } catch (err) {
      return NextResponse.json(
        {
          configured: true,
          error: `Locaweb retornou erro ao consultar saldo: ${(err as Error).message}`,
        },
        { status: 200 }
      );
    }
  } catch (err) {
    return handleAuthError(err);
  }
}
