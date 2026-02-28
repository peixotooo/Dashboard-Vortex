import { NextRequest, NextResponse } from "next/server";
import { getInstagramAccounts } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const accountId = request.nextUrl.searchParams.get("account_id") || "";
    if (!accountId) {
      return NextResponse.json({ error: "account_id is required" }, { status: 400 });
    }

    const result = await getInstagramAccounts(accountId);
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}
