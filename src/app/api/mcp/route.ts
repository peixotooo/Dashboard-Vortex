import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/mcp-client";

export async function POST(request: NextRequest) {
  try {
    const { tool, args } = await request.json();

    if (!tool || typeof tool !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'tool' parameter" },
        { status: 400 }
      );
    }

    const result = await callTool(tool, args || {});
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`MCP tool error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
