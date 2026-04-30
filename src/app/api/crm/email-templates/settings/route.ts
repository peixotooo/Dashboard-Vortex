// src/app/api/crm/email-templates/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getSettings, upsertSettings } from "@/lib/email-templates/settings";

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const settings = await getSettings(workspaceId);
    return NextResponse.json(settings);
  } catch (err) {
    return handleAuthError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const body = await req.json().catch(() => ({}));
    try {
      const updated = await upsertSettings({ ...body, workspace_id: workspaceId });
      return NextResponse.json(updated);
    } catch (err) {
      return NextResponse.json(
        { error: String((err as Error).message) },
        { status: 400 }
      );
    }
  } catch (err) {
    return handleAuthError(err);
  }
}
