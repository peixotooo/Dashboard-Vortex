import { NextRequest, NextResponse } from "next/server";
import { getInstagramAccounts, runWithToken } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError, requireMetaTokenForRequest } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId, accessToken } = await getAuthenticatedContext(request);

    const accountId = request.nextUrl.searchParams.get("account_id") || "";
    if (!accountId) {
      return NextResponse.json({ error: "account_id is required" }, { status: 400 });
    }

    const _tok = await requireMetaTokenForRequest(
      workspaceId,
      accountId,
      accessToken
    );

    const result = await runWithToken(_tok, () => getInstagramAccounts(accountId));
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}
