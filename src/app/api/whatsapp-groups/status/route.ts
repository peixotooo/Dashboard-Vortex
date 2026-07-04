import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import {
  getWapiConfig,
  getInstanceStatus,
  updateWapiConnected,
} from "@/lib/wapi-api";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const config = await getWapiConfig(workspaceId);
    if (!config)
      return NextResponse.json(
        { error: "W-API not configured" },
        { status: 400 }
      );

    const status = await getInstanceStatus(config);
    const isConnected = status.connected === true;

    await updateWapiConnected(workspaceId, isConnected);

    return NextResponse.json({
      instanceId: status.instanceId,
      connected: isConnected,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
