import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/mcp-client";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const campaign_id = searchParams.get("campaign_id") || "";
    const account_id = searchParams.get("account_id") || "";
    const limit = searchParams.get("limit") || "25";

    const args: Record<string, unknown> = { limit: parseInt(limit) };
    if (campaign_id) args.campaign_id = campaign_id;
    if (account_id) args.account_id = account_id;

    const tool = campaign_id ? "list_campaign_ad_sets" : "list_ad_sets";
    const result = await callTool(tool, args);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await callTool("create_ad_set", body);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
