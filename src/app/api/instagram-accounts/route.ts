import { NextRequest, NextResponse } from "next/server";
import { getInstagramAccounts, runWithToken } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError, resolveTokenForAccount } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const accountId = request.nextUrl.searchParams.get("account_id") || "";
    if (!accountId) {
      return NextResponse.json({ error: "account_id is required" }, { status: 400 });
    }

    const workspaceId = request.headers.get("x-workspace-id") || "";
    const _tok = accountId && accountId !== "all"
      ? await resolveTokenForAccount(workspaceId, accountId)
      : null;

    const result = await runWithToken(_tok, () => getInstagramAccounts(accountId));
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}
