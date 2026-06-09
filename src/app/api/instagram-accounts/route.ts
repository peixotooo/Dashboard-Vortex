import { NextRequest, NextResponse } from "next/server";
import { getInstagramAccounts } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError, setTokenForAccount } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const accountId = request.nextUrl.searchParams.get("account_id") || "";
    if (!accountId) {
      return NextResponse.json({ error: "account_id is required" }, { status: 400 });
    }

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (accountId && accountId !== "all") await setTokenForAccount(workspaceId, accountId);

    const result = await getInstagramAccounts(accountId);
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}
