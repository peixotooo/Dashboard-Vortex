// src/app/api/crm/email-templates/provider/route.ts
//
// GET → qual provider está ativo (locaweb | iporto) + se está enabled
// PUT → troca o provider ativo

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import {
  getActiveProvider,
  setActiveProvider,
  type EmailProvider,
} from "@/lib/email-providers";

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
    const { workspaceId } = await getWorkspaceContext(req);
    const body = (await req.json()) as { provider?: EmailProvider };
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
