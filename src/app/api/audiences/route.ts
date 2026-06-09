import { NextRequest, NextResponse } from "next/server";
import {
  listAudiences,
  createCustomAudience,
  createLookalikeAudience,
  estimateAudienceSize,
} from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError, setTokenForAccount } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const { searchParams } = new URL(request.url);
    const account_id = searchParams.get("account_id") || "";
    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (account_id && account_id !== "all") await setTokenForAccount(workspaceId, account_id);

    const result = await listAudiences({ account_id });
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const body = await request.json();
    const { type, ...args } = body;
    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (args.account_id && args.account_id !== "all") await setTokenForAccount(workspaceId, args.account_id);

    let result;
    switch (type) {
      case "lookalike":
        result = await createLookalikeAudience(args);
        break;
      case "estimate":
        result = await estimateAudienceSize(args);
        break;
      default:
        result = await createCustomAudience(args);
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}
