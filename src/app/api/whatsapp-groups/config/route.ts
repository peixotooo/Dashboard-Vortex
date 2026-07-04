import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getWapiConfig, saveWapiConfig } from "@/lib/wapi-api";

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
    const { workspaceId } = await getWorkspaceContext(request);

    const body = await request.json();
    const { instanceId, token } = body;

    if (!instanceId || !token) {
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
