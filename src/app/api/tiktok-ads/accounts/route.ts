import { NextRequest, NextResponse } from "next/server";
import { getTikTokAdvertisers } from "@/lib/tiktok-ads-api";
import { getTikTokCredentials } from "@/lib/tiktok-credentials";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";

/**
 * Lists the TikTok advertiser accounts the connected workspace token is authorized
 * for (id + name + currency). Used to discover/label advertiser_id for the tab.
 */
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const creds = await getTikTokCredentials(workspaceId);
    if (!creds) {
      return NextResponse.json(
        { error: "TikTok nao conectado. Conecte em /api/tiktok/auth.", needs_connection: true },
        { status: 400 }
      );
    }

    const accounts = await getTikTokAdvertisers(creds.accessToken);
    return NextResponse.json({ accounts });
  } catch (error) {
    return handleAuthError(error);
  }
}
