import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getWapiConfig, restartInstance } from "@/lib/wapi-api";

export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const config = await getWapiConfig(workspaceId);
    if (!config)
      return NextResponse.json(
        { error: "W-API not configured" },
        { status: 400 }
      );

    const result = await restartInstance(config);

    return NextResponse.json({
      ok: true,
      instanceId: config.instanceId,
      message: result.message || "Instancia reiniciada.",
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
