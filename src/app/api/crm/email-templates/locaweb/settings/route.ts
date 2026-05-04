// src/app/api/crm/email-templates/locaweb/settings/route.ts
//
// GET  → return current Locaweb settings for the workspace (token redacted)
// PUT  → upsert; if "test: true" body field is set, also pings the API to
//        validate token + account before saving.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import {
  getLocawebSettings,
  upsertLocawebSettings,
  type UpdateSettingsInput,
} from "@/lib/locaweb/settings";
import { ping } from "@/lib/locaweb/email-marketing";

export const runtime = "nodejs";

function redactToken(token: string | null): string | null {
  if (!token) return null;
  if (token.length <= 8) return "***";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const s = await getLocawebSettings(workspaceId);
    return NextResponse.json({
      ...s,
      token_set: !!s.token,
      token: redactToken(s.token),
    });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const body = (await req.json()) as UpdateSettingsInput & { test?: boolean };

    // Optional connectivity probe before persisting.
    if (body.test) {
      const account_id = body.account_id ?? (await getLocawebSettings(workspaceId)).account_id;
      const token = body.token ?? (await getLocawebSettings(workspaceId)).token;
      const base_url =
        body.base_url ?? (await getLocawebSettings(workspaceId)).base_url;
      if (!account_id || !token) {
        return NextResponse.json(
          { error: "account_id e token obrigatórios pra testar" },
          { status: 400 }
        );
      }
      try {
        const result = await ping({ base_url, account_id, token });
        return NextResponse.json({ ok: true, probe: result });
      } catch (err) {
        const e = err as { status?: number; message?: string };
        return NextResponse.json(
          { ok: false, error: e.message ?? "ping failed", status: e.status ?? 500 },
          { status: 200 }
        );
      }
    }

    const next = await upsertLocawebSettings(workspaceId, body);
    return NextResponse.json({
      ...next,
      token_set: !!next.token,
      token: redactToken(next.token),
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
