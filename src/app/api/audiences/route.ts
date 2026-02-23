import { NextRequest, NextResponse } from "next/server";
import {
  listAudiences,
  createCustomAudience,
  createLookalikeAudience,
  estimateAudienceSize,
} from "@/lib/meta-api";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const account_id = searchParams.get("account_id") || "";

    const result = await listAudiences({ account_id });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message, audiences: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, ...args } = body;

    let result;
    switch (type) {
      case "lookalike":
        result = await createLookalikeAudience(args);
        break;
      case "estimate":
        result = await estimateAudienceSize(args);
        break;
      default:
        result = await createCustomAudience(args);
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
