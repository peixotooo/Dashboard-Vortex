import { NextRequest, NextResponse } from "next/server";
import { listAdSets, createAdSet } from "@/lib/meta-api";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const campaign_id = searchParams.get("campaign_id") || "";
    const account_id = searchParams.get("account_id") || "";
    const limit = parseInt(searchParams.get("limit") || "25");

    const result = await listAdSets({ campaign_id, account_id, limit });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message, ad_sets: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await createAdSet(body);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
