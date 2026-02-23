import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/mcp-client";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const account_id = searchParams.get("account_id") || "";
    const status = searchParams.get("status") || "";
    const limit = searchParams.get("limit") || "25";

    const args: Record<string, unknown> = { limit: parseInt(limit) };
    if (account_id) args.account_id = account_id;
    if (status) args.status_filter = status;

    const result = await callTool("list_campaigns", args);
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

    let tool = "create_campaign";
    if (action === "pause") tool = "pause_campaign";
    else if (action === "resume") tool = "resume_campaign";
    else if (action === "delete") tool = "delete_campaign";
    else if (action === "update") tool = "update_campaign";

    const result = await callTool(tool, args);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
