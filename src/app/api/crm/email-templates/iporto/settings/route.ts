// src/app/api/crm/email-templates/iporto/settings/route.ts
//
// GET → settings iPORTO (token redacted)
// PUT → upsert. Se body.test=true, faz ping antes de salvar.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import {
  getIportoSettings,
  upsertIportoSettings,
  type UpdateIportoSettingsInput,
} from "@/lib/iporto/settings";
import { ping } from "@/lib/iporto/email-marketing";
import { validatePublicHttpUrl } from "@/lib/security/external-url";

export const runtime = "nodejs";

function redactToken(token: string | null): string | null {
  if (!token) return null;
  if (token.length <= 8) return "***";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const s = await getIportoSettings(workspaceId);
    return NextResponse.json({
      ...s,
      token_set: !!s.token,
      token: redactToken(s.token),
      webhook_secret_set: !!s.webhook_secret,
      webhook_secret: s.webhook_secret ? "***" : null,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const body = (await req.json()) as UpdateIportoSettingsInput & {
      test?: boolean;
    };

    if (body.test) {
      const current = await getIportoSettings(workspaceId);
      const token = body.token ?? current.token;
      const base_url = body.base_url ?? current.base_url;
      if (!token) {
        return NextResponse.json(
          { error: "token obrigatório pra testar" },
          { status: 400 }
        );
      }
      // Anti-SSRF: base_url vem do cliente e o ping envia o token; bloqueia
      // host interno/IP privado (metadata da nuvem, localhost, rede interna).
      try {
        await validatePublicHttpUrl(base_url, "base_url");
      } catch {
        return NextResponse.json(
          { ok: false, error: "base_url inválida" },
          { status: 400 }
        );
      }
      try {
        const result = await ping({ base_url, token });
        return NextResponse.json({ ok: true, probe: result });
      } catch (err) {
        const e = err as { status?: number; message?: string };
        return NextResponse.json(
          { ok: false, error: e.message ?? "ping failed", status: e.status ?? 500 },
          { status: 200 }
        );
      }
    }

    const next = await upsertIportoSettings(workspaceId, body);
    return NextResponse.json({
      ...next,
      token_set: !!next.token,
      token: redactToken(next.token),
      webhook_secret_set: !!next.webhook_secret,
      webhook_secret: next.webhook_secret ? "***" : null,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
