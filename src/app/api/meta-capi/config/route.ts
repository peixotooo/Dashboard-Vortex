import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { isMetaCapiEnabledForWorkspace } from "@/lib/workspace-integration-settings";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json(
      { enabled: false, error: "Invalid API key" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const enabled = await isMetaCapiEnabledForWorkspace(auth.workspaceId);
  return NextResponse.json(
    { enabled },
    {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "Access-Control-Max-Age": "86400",
    },
  });
}
