import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  const appId = process.env.ML_APP_ID;
  const redirectUri = process.env.ML_REDIRECT_URI;

  if (!appId || !redirectUri) {
    return NextResponse.json(
      { error: "ML_APP_ID and ML_REDIRECT_URI must be configured" },
      { status: 500 }
    );
  }

  // Generate state for CSRF protection
  const state = crypto.randomBytes(16).toString("hex");

  // Pass workspace_id through state param (state:workspaceId)
  const workspaceId = req.nextUrl.searchParams.get("workspace_id") || "";
  const stateParam = `${state}:${workspaceId}`;

  const url = new URL("https://auth.mercadolivre.com.br/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", stateParam);

  return NextResponse.redirect(url.toString());
}
