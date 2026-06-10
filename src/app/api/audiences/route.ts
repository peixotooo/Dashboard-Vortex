import { NextRequest, NextResponse } from "next/server";
import {
  listAudiences,
  createCustomAudience,
  createLookalikeAudience,
  estimateAudienceSize,
  runWithToken,
} from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError, requireMetaTokenForRequest } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId, accessToken } = await getAuthenticatedContext(request);

    const { searchParams } = new URL(request.url);
    const account_id = searchParams.get("account_id") || "";
    const _tok = await requireMetaTokenForRequest(workspaceId, account_id, accessToken);

    const result = await runWithToken(_tok, () => listAudiences({ account_id }));
    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { workspaceId, accessToken } = await getAuthenticatedContext(request);

    const body = await request.json();
    const { type, ...args } = body;
    const _tok = await requireMetaTokenForRequest(workspaceId, args.account_id, accessToken);

    let result;
    switch (type) {
      case "lookalike":
        result = await runWithToken(_tok, () => createLookalikeAudience(args));
        break;
      case "estimate":
        result = await runWithToken(_tok, () => estimateAudienceSize(args));
        break;
      default:
        result = await runWithToken(_tok, () => createCustomAudience(args));
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}
