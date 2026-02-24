import { NextRequest, NextResponse } from "next/server";
import { listCreatives, getCreativeDetails } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const { searchParams } = new URL(request.url);
    const account_id = searchParams.get("account_id") || "";

    const result = await listCreatives({ account_id });
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const body = await request.json();

    if (body.action === "details" && body.creative_id) {
      const result = await getCreativeDetails({
        creative_id: body.creative_id,
        account_id: body.account_id,
      });
      return NextResponse.json(result);
    }

    const result = await listCreatives({ account_id: body.account_id });
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}
