import { NextRequest, NextResponse } from "next/server";
import { listAccessibleCustomersDetailed } from "@/lib/google-ads-api";

/**
 * Lists the Google Ads accounts accessible to the configured OAuth credentials.
 * Used to discover GOOGLE_ADS_CUSTOMER_ID (and, for MCC setups, which account is
 * the manager → GOOGLE_ADS_LOGIN_CUSTOMER_ID). Surfaces the real Google Ads error
 * (e.g. DEVELOPER_TOKEN_NOT_APPROVED) so misconfigs are obvious.
 */
export async function GET(_request: NextRequest) {
  try {
    const accounts = await listAccessibleCustomersDetailed();
    return NextResponse.json({ accounts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
