import { NextRequest, NextResponse } from "next/server";
import {
  getWorkspaceAdminContext,
  getWorkspaceContext,
  handleAuthError,
} from "@/lib/api-auth";
import { getWaConfig, saveWaConfig } from "@/lib/whatsapp-api";
import { readLimitedJson } from "@/lib/security/webhook-request";

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
    const { workspaceId } = await getWorkspaceAdminContext(request);

    const parsed = await readLimitedJson(request, 32 * 1024);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const body = parsed.value as Record<string, unknown>;
    const { phoneNumberId, wabaId, accessToken, displayPhone } = body;

    if (
      typeof phoneNumberId !== "string" ||
      !/^\d{5,40}$/.test(phoneNumberId) ||
      typeof wabaId !== "string" ||
      !/^\d{5,40}$/.test(wabaId) ||
      typeof accessToken !== "string" ||
      accessToken.length < 20 ||
      accessToken.length > 8192 ||
      (displayPhone !== undefined &&
        (typeof displayPhone !== "string" || displayPhone.length > 40))
    ) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await saveWaConfig(workspaceId, { phoneNumberId, wabaId, accessToken, displayPhone });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleAuthError(error);
  }
}
