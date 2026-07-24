// src/app/api/crm/email-templates/locaweb/settings/route.ts
//
// GET  → return current Locaweb settings for the workspace (token redacted)
// PUT  → upsert; if "test: true" body field is set, also pings the API to
//        validate token + account before saving.

import { NextRequest, NextResponse } from "next/server";
import {
  getWorkspaceAdminContext,
  handleAuthError,
} from "@/lib/api-auth";
import {
  getLocawebSettings,
  upsertLocawebSettings,
  type UpdateSettingsInput,
} from "@/lib/locaweb/settings";
import { ping } from "@/lib/locaweb/email-marketing";
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
    const body = parsed.value as UpdateSettingsInput & { test?: boolean };
    const rate = await consumeSecurityRateLimit({
      scope: "locaweb:settings",
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
      // Anti-SSRF: base_url é controlada pelo cliente e o ping envia o token.
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
