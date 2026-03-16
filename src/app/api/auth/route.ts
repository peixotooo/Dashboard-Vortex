import { NextRequest, NextResponse } from "next/server";
import { getTokenInfo, healthCheck } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    await getAuthenticatedContext(request);
    const result = await getTokenInfo();
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await getAuthenticatedContext(request);

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
    return handleAuthError(error);
  }
}
