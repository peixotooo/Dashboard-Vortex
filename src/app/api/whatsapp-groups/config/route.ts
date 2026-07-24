import { NextRequest, NextResponse } from "next/server";
import {
  getWorkspaceAdminContext,
  getWorkspaceContext,
  handleAuthError,
} from "@/lib/api-auth";
import { getWapiConfig, saveWapiConfig } from "@/lib/wapi-api";
import { readLimitedJson } from "@/lib/security/webhook-request";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const config = await getWapiConfig(workspaceId);
    if (!config) return NextResponse.json({ configured: false });

    return NextResponse.json({
      configured: true,
      instanceId: config.instanceId,
      connected: config.connected,
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
    const { instanceId, token } = body;

    if (
      typeof instanceId !== "string" ||
      !/^[a-zA-Z0-9_-]{3,200}$/.test(instanceId) ||
      typeof token !== "string" ||
      token.length < 8 ||
      token.length > 8192
    ) {
      return NextResponse.json(
        { error: "Missing required fields: instanceId and token" },
        { status: 400 }
      );
    }

    await saveWapiConfig(workspaceId, { instanceId, token });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleAuthError(error);
  }
}
