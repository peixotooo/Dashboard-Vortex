import { NextRequest, NextResponse } from "next/server";
import { listCreatives, getCreativeDetails } from "@/lib/meta-api";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const account_id = searchParams.get("account_id") || "";

    const result = await listCreatives({ account_id });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message, creatives: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
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
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
