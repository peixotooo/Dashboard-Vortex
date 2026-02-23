import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/mcp-client";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const object_id = searchParams.get("object_id") || "";
    const level = searchParams.get("level") || "account";
    const date_preset = searchParams.get("date_preset") || "last_30d";
    const breakdowns = searchParams.get("breakdowns") || "";
    const fields = searchParams.get("fields") || "";

    const args: Record<string, unknown> = {
      object_id,
      level,
      date_preset,
    };

    if (breakdowns) args.breakdowns = breakdowns.split(",");
    if (fields) args.fields = fields.split(",");

    const result = await callTool("get_insights", args);
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

    let tool = "get_insights";
    if (action === "compare") tool = "compare_performance";
    else if (action === "export") tool = "export_insights";

    const result = await callTool(tool, args);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
