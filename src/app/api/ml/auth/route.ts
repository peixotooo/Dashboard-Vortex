import { NextRequest, NextResponse } from "next/server";
import {
  getWorkspaceAdminContext,
  handleAuthError,
} from "@/lib/api-auth";
import { createOAuthState } from "@/lib/security/oauth-state";

export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceAdminContext(req);
    const appId = process.env.ML_APP_ID;
    const redirectUri = process.env.ML_REDIRECT_URI;

    if (!appId || !redirectUri) {
      return NextResponse.json(
        { error: "ML_APP_ID and ML_REDIRECT_URI must be configured" },
        { status: 500 }
      );
    }

    const { nonce, state } = createOAuthState(workspaceId);

    const url = new URL("https://auth.mercadolivre.com.br/authorization");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);

    const response = NextResponse.redirect(url.toString());
    response.cookies.set("ml_oauth_state", nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    return handleAuthError(error);
  }
}
