import { NextRequest, NextResponse } from "next/server";
import { getAdAccounts } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {
      // Fallback: env token will be used
    });

    const result = await getAdAccounts();
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}
