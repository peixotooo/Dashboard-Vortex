// src/app/api/crm/email-templates/provider/route.ts
//
// GET → qual provider está ativo (locaweb | iporto) + se está enabled
// PUT → troca o provider ativo

import { NextRequest, NextResponse } from "next/server";
import {
  getWorkspaceAdminContext,
  getWorkspaceContext,
  handleAuthError,
} from "@/lib/api-auth";
import {
  getActiveProvider,
  setActiveProvider,
  type EmailProvider,
} from "@/lib/email-providers";
import { readLimitedJson } from "@/lib/security/webhook-request";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const info = await getActiveProvider(workspaceId);
    return NextResponse.json(info);
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceAdminContext(req);
    const parsed = await readLimitedJson(req, 8 * 1024);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body =
      parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
        ? (parsed.value as { provider?: EmailProvider })
        : {};
    if (body.provider !== "locaweb" && body.provider !== "iporto") {
      return NextResponse.json(
        { error: "provider deve ser 'locaweb' ou 'iporto'" },
        { status: 400 }
      );
    }
    await setActiveProvider(workspaceId, body.provider);
    const info = await getActiveProvider(workspaceId);
    return NextResponse.json(info);
  } catch (err) {
    return handleAuthError(err);
  }
}
