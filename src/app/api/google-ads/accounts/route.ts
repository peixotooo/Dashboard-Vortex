import { NextRequest, NextResponse } from "next/server";
import {
  getWorkspaceAdminContext,
  handleAuthError,
} from "@/lib/api-auth";
import { listAccessibleCustomersDetailed } from "@/lib/google-ads-api";

/**
 * Lists the Google Ads accounts accessible to the configured OAuth credentials.
 * Used to discover GOOGLE_ADS_CUSTOMER_ID (and, for MCC setups, which account is
 * the manager → GOOGLE_ADS_LOGIN_CUSTOMER_ID). Surfaces the real Google Ads error
 * (e.g. DEVELOPER_TOKEN_NOT_APPROVED) so misconfigs are obvious.
 */
export async function GET(request: NextRequest) {
  try {
    await getWorkspaceAdminContext(request);
    const accounts = await listAccessibleCustomersDetailed();
    return NextResponse.json({ accounts });
  } catch (error) {
    const authResponse = handleAuthError(error);
    if (authResponse.status !== 500) return authResponse;
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
