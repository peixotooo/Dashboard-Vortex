import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/mcp-client";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const account_id = searchParams.get("account_id") || "";

    const args: Record<string, unknown> = {};
    if (account_id) args.account_id = account_id;

    const result = await callTool("list_audiences", args);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, ...args } = body;

    let tool = "create_custom_audience";
    if (type === "lookalike") tool = "create_lookalike_audience";
    else if (type === "estimate") tool = "estimate_audience_size";

    const result = await callTool(tool, args);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
