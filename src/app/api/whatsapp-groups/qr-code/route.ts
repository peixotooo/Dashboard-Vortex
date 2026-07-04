import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getWapiConfig, getQrCode } from "@/lib/wapi-api";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const config = await getWapiConfig(workspaceId);
    if (!config)
      return NextResponse.json(
        { error: "W-API not configured" },
        { status: 400 }
      );

    const qr = await getQrCode(config);

    return NextResponse.json({
      qrcode: qr.qrcode,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
