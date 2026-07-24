import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceAdminContext } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { encrypt } from "@/lib/encryption";
import {
  oauthNonceMatches,
  parseOAuthState,
} from "@/lib/security/oauth-state";

function redirect(req: NextRequest, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, req.url));
  response.cookies.delete("ml_oauth_state");
  return response;
}

async function requireCurrentWorkspaceAdmin(
  req: NextRequest,
  workspaceId: string
): Promise<void> {
  const authUrl = req.nextUrl.clone();
  authUrl.searchParams.set("workspace_id", workspaceId);
  const authRequest = new NextRequest(authUrl, { headers: req.headers });
  await getWorkspaceAdminContext(authRequest);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") || "";

  if (!code) {
    return redirect(req, "/hub?error=missing_code");
  }

  const parsedState = parseOAuthState(state);
  const cookieNonce = req.cookies.get("ml_oauth_state")?.value;
  if (
    !parsedState ||
    !oauthNonceMatches(cookieNonce, parsedState.nonce)
  ) {
    return redirect(req, "/hub?error=state_mismatch");
  }

  const { workspaceId } = parsedState;
  try {
    await requireCurrentWorkspaceAdmin(req, workspaceId);
  } catch {
    return redirect(req, "/hub?error=oauth_unauthorized");
  }

  // Exchange code for token
  const tokenRes = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.ML_APP_ID!,
      client_secret: process.env.ML_CLIENT_SECRET!,
      code,
      redirect_uri: process.env.ML_REDIRECT_URI!,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text().catch(() => "Unknown error");
    console.error("[ML Callback] Token exchange failed:", err);
    return redirect(req, "/hub?error=token_exchange_failed");
  }

  const tokenData = await tokenRes.json();

  // Fetch user info (nickname)
  const userRes = await fetch("https://api.mercadolibre.com/users/me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const userData = userRes.ok ? await userRes.json() : {};

  // Upsert credentials (encrypted)
  const supabase = createAdminClient();
  const { error } = await supabase.from("ml_credentials").upsert(
    {
      workspace_id: workspaceId,
      ml_user_id: tokenData.user_id,
      ml_nickname: userData.nickname || null,
      access_token: encrypt(tokenData.access_token),
      refresh_token: encrypt(tokenData.refresh_token),
      expires_at: new Date(
        Date.now() + tokenData.expires_in * 1000
      ).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,ml_user_id" }
  );

  if (error) {
    console.error("[ML Callback] DB upsert failed:", error.message);
    return redirect(req, "/hub?error=db_save_failed");
  }

  // Log the connection
  await supabase.from("hub_logs").insert({
    workspace_id: workspaceId,
    action: "ml_connected",
    entity: "credentials",
    entity_id: String(tokenData.user_id),
    direction: "ml_to_hub",
    status: "ok",
    details: { nickname: userData.nickname },
  });

  return redirect(req, "/hub");
}
