import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/mcp-client";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const account_id = searchParams.get("account_id") || "";

    const args: Record<string, unknown> = {};
    if (account_id) args.account_id = account_id;

    const result = await callTool("list_creatives", args);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ...args } = body;

    let tool = "create_ad_creative";
    if (action === "validate") tool = "validate_creative_setup";
    else if (action === "performance") tool = "get_creative_performance";

    const result = await callTool(tool, args);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
