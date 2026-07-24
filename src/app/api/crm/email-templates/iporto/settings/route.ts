// src/app/api/crm/email-templates/iporto/settings/route.ts
//
// GET → settings iPORTO (token redacted)
// PUT → upsert. Se body.test=true, faz ping antes de salvar.

import { NextRequest, NextResponse } from "next/server";
import {
  getWorkspaceAdminContext,
  handleAuthError,
} from "@/lib/api-auth";
import {
  getIportoSettings,
  upsertIportoSettings,
  type UpdateIportoSettingsInput,
} from "@/lib/iporto/settings";
import { ping } from "@/lib/iporto/email-marketing";
import { validatePublicHttpUrl } from "@/lib/security/external-url";
import { consumeSecurityRateLimit } from "@/lib/security/rate-limit";
import { readLimitedJson } from "@/lib/security/webhook-request";

export const runtime = "nodejs";

function redactToken(token: string | null): string | null {
  if (!token) return null;
  if (token.length <= 8) return "***";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceAdminContext(req);
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
    const { workspaceId, userId } = await getWorkspaceAdminContext(req);
    const parsed = await readLimitedJson(req, 64 * 1024);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.error },
        { status: parsed.status }
      );
    }
    if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }
    const body = parsed.value as UpdateIportoSettingsInput & {
      test?: boolean;
    };
    const rate = await consumeSecurityRateLimit({
      scope: "iporto:settings",
      key: `${workspaceId}:${userId}`,
      limit: 30,
      windowSeconds: 3600,
    });
    if (!rate.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    if (body.base_url !== undefined) {
      if (typeof body.base_url !== "string" || body.base_url.length > 2048) {
        return NextResponse.json({ error: "base_url inválida" }, { status: 400 });
      }
      try {
        const validated = await validatePublicHttpUrl(body.base_url, "base_url");
        if (validated.protocol !== "https:") throw new Error("HTTPS required");
        body.base_url = validated.toString().replace(/\/+$/, "");
      } catch {
        return NextResponse.json({ error: "base_url inválida" }, { status: 400 });
      }
    }
    if (
      body.token !== undefined &&
      (typeof body.token !== "string" || body.token.length > 8192)
    ) {
      return NextResponse.json({ error: "token inválido" }, { status: 400 });
    }

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
        const validated = await validatePublicHttpUrl(base_url, "base_url");
        if (validated.protocol !== "https:") throw new Error("HTTPS required");
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
