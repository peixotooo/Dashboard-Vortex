import { NextRequest, NextResponse } from "next/server";
import { listAds, createAd, runWithToken } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError, resolveTokenForAccount } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const { searchParams } = new URL(request.url);
    const campaign_id = searchParams.get("campaign_id") || "";
    const adset_id = searchParams.get("adset_id") || "";
    const account_id = searchParams.get("account_id") || "";
    const limit = parseInt(searchParams.get("limit") || "25");

    const workspaceId = request.headers.get("x-workspace-id") || "";
    const _tok = account_id && account_id !== "all" ? await resolveTokenForAccount(workspaceId, account_id) : null;

    const result = await runWithToken(_tok, () => listAds({ campaign_id, adset_id, account_id, limit }));
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const body = await request.json();
    const account_id = body.account_id || "";
    const workspaceId = request.headers.get("x-workspace-id") || "";
    const _tok = account_id && account_id !== "all" ? await resolveTokenForAccount(workspaceId, account_id) : null;
    const result = await runWithToken(_tok, () => createAd(body));
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}
