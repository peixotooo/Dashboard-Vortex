import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/mcp-client";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  try {
    await getAuthenticatedContext(request);

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
    return handleAuthError(error);
  }
}
