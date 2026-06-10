import { NextRequest, NextResponse } from "next/server";
import { upsertTikTokCredentials } from "@/lib/tiktok-credentials";
import { createAdminClient } from "@/lib/supabase-admin";

const API_VERSION = process.env.TIKTOK_API_VERSION?.trim() || "v1.3";
const TOKEN_URL = `https://business-api.tiktok.com/open_api/${API_VERSION}/oauth2/access_token/`;

/**
 * TikTok Marketing API OAuth callback. Mirrors src/app/api/ml/callback/route.ts but:
 *  - reads `auth_code` (TikTok's param), not `code`
 *  - VERIFIES the CSRF nonce stored in the cookie by the auth route
 *  - exchanges via JSON POST with grant_type:"auth_code"
 *  - stores a DURABLE token (no refresh_token / expires_at) plus advertiser_ids[]
 */
export async function GET(req: NextRequest) {
  const authCode =
    req.nextUrl.searchParams.get("auth_code") ||
    req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") || "";

  if (!authCode) {
    return NextResponse.redirect(new URL("/tiktok-ads?error=tiktok_no_code", req.url));
  }

  // Recover workspace_id and verify CSRF nonce against the cookie.
  const parts = state.split(":");
  const csrf = parts[0] || "";
  const workspaceId = parts.length > 1 ? parts.slice(1).join(":") : "";
  const cookieCsrf = req.cookies.get("tiktok_oauth_state")?.value || "";

  if (!workspaceId) {
    return NextResponse.redirect(new URL("/tiktok-ads?error=tiktok_missing_workspace", req.url));
  }
  if (!csrf || csrf !== cookieCsrf) {
    return NextResponse.redirect(new URL("/tiktok-ads?error=tiktok_state_mismatch", req.url));
  }

  const appId = process.env.TIKTOK_APP_ID;
  const secret = process.env.TIKTOK_APP_SECRET;
  if (!appId || !secret) {
    return NextResponse.redirect(new URL("/tiktok-ads?error=tiktok_not_configured", req.url));
  }

  // Exchange auth_code -> durable access token.
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: appId,
      secret,
      auth_code: authCode,
      grant_type: "auth_code",
    }),
  });

  const tokenJson = (await tokenRes.json().catch(() => null)) as
    | {
        code?: number;
        message?: string;
        data?: {
          access_token?: string;
          advertiser_ids?: Array<string | number>;
          scope?: Array<string | number>;
        };
      }
    | null;

  if (!tokenJson || tokenJson.code !== 0 || !tokenJson.data?.access_token) {
    console.error(
      "[TikTok Callback] Token exchange failed:",
      tokenJson?.code,
      tokenJson?.message
    );
    return NextResponse.redirect(
      new URL("/tiktok-ads?error=tiktok_token_exchange_failed", req.url)
    );
  }

  const accessToken = tokenJson.data.access_token;
  const advertiserIds = (tokenJson.data.advertiser_ids || []).map((v) => String(v));
  const scope = (tokenJson.data.scope || [])
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));

  try {
    await upsertTikTokCredentials(workspaceId, {
      accessToken,
      advertiserIds,
      scope,
      appId,
    });
  } catch (err) {
    console.error(
      "[TikTok Callback] DB upsert failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.redirect(new URL("/tiktok-ads?error=tiktok_db_save_failed", req.url));
  }

  // Best-effort connection log (mirrors the ML callback). Never block the redirect.
  try {
    const supabase = createAdminClient();
    await supabase.from("hub_logs").insert({
      workspace_id: workspaceId,
      action: "tiktok_connected",
      entity: "credentials",
      entity_id: advertiserIds[0] || "",
      direction: "tiktok_to_hub",
      status: "ok",
      details: { advertiser_ids: advertiserIds, scope },
    });
  } catch {
    // hub_logs is non-critical here.
  }

  const res = NextResponse.redirect(new URL("/tiktok-ads?tiktok=connected", req.url));
  res.cookies.delete("tiktok_oauth_state");
  return res;
}
