import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/mcp-client";

export async function GET() {
  try {
    const result = await callTool("get_token_info");
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

    let tool = "generate_auth_url";
    if (action === "exchange") tool = "exchange_code_for_token";
    else if (action === "refresh") tool = "refresh_to_long_lived_token";
    else if (action === "health") tool = "health_check";
    else if (action === "verify") tool = "verify_account_setup";

    const result = await callTool(tool, args);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
