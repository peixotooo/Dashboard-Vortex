import { NextRequest, NextResponse } from "next/server";
import { listAds, createAd } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const { searchParams } = new URL(request.url);
    const campaign_id = searchParams.get("campaign_id") || "";
    const adset_id = searchParams.get("adset_id") || "";
    const account_id = searchParams.get("account_id") || "";
    const limit = parseInt(searchParams.get("limit") || "25");

    const result = await listAds({ campaign_id, adset_id, account_id, limit });
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const body = await request.json();
    const result = await createAd(body);
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}
