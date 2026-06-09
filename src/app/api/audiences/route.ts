import { NextRequest, NextResponse } from "next/server";
import {
  listAudiences,
  createCustomAudience,
  createLookalikeAudience,
  estimateAudienceSize,
  runWithToken,
} from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError, resolveTokenForAccount } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const { searchParams } = new URL(request.url);
    const account_id = searchParams.get("account_id") || "";
    const workspaceId = request.headers.get("x-workspace-id") || "";
    const _tok = account_id && account_id !== "all" ? await resolveTokenForAccount(workspaceId, account_id) : null;

    const result = await runWithToken(_tok, () => listAudiences({ account_id }));
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
    const _tok = args.account_id && args.account_id !== "all" ? await resolveTokenForAccount(workspaceId, args.account_id) : null;

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
