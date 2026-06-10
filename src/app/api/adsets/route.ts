import { NextRequest, NextResponse } from "next/server";
import { listAdSets, createAdSet, runWithToken } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError, requireMetaTokenForRequest } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId, accessToken } = await getAuthenticatedContext(request);

    const { searchParams } = new URL(request.url);
    const campaign_id = searchParams.get("campaign_id") || "";
    const account_id = searchParams.get("account_id") || "";
    const limit = parseInt(searchParams.get("limit") || "25");

    const _tok = await requireMetaTokenForRequest(workspaceId, account_id, accessToken);

    const result = await runWithToken(_tok, () => listAdSets({ campaign_id, account_id, limit }));
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { workspaceId, accessToken } = await getAuthenticatedContext(request);

    const body = await request.json();
    const account_id = body.account_id || "";
    const _tok = await requireMetaTokenForRequest(workspaceId, account_id, accessToken);
    const result = await runWithToken(_tok, () => createAdSet(body));
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}
