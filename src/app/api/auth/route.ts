import { NextRequest, NextResponse } from "next/server";
import { getTokenInfo, healthCheck } from "@/lib/meta-api";

export async function GET() {
  try {
    const result = await getTokenInfo();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "health" || action === "verify") {
      const result = await healthCheck();
      return NextResponse.json(result);
    }

    if (action === "token_info") {
      const result = await getTokenInfo();
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
