import { NextResponse } from "next/server";
import { callTool } from "@/lib/mcp-client";

export async function GET() {
  try {
    const result = await callTool("get_ad_accounts");
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message, accounts: [] }, { status: 500 });
  }
}
