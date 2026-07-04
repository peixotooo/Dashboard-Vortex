import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getWaConfig, saveWaConfig } from "@/lib/whatsapp-api";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const config = await getWaConfig(workspaceId);
    if (!config) return NextResponse.json({ configured: false });

    return NextResponse.json({
      configured: true,
      phoneNumberId: config.phoneNumberId,
      wabaId: config.wabaId,
      displayPhone: config.displayPhone || "",
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const body = await request.json();
    const { phoneNumberId, wabaId, accessToken, displayPhone } = body;

    if (!phoneNumberId || !wabaId || !accessToken) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await saveWaConfig(workspaceId, { phoneNumberId, wabaId, accessToken, displayPhone });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleAuthError(error);
  }
}
