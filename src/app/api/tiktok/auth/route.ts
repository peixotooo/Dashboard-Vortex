import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

/**
 * Starts the TikTok Marketing API OAuth flow. Mirrors src/app/api/ml/auth/route.ts,
 * but persists the CSRF half of `state` in an httpOnly cookie so the callback can
 * verify it (the ML route generates state but never checks it — closed here).
 *
 * The portal issues a ready-made "Advertiser authorization URL" that already embeds
 * app_id + the TikTok-issued rid + the checked scopes. Put that whole URL in
 * TIKTOK_AUTH_URL; this route only appends &state=... and redirect_uri. If
 * TIKTOK_AUTH_URL is absent we build the URL from app_id + rid + redirect_uri.
 */
export async function GET(req: NextRequest) {
  const appId = process.env.TIKTOK_APP_ID;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;
  const authUrl = process.env.TIKTOK_AUTH_URL;
  const rid = process.env.TIKTOK_AUTH_RID;

  if (!appId || !redirectUri) {
    return NextResponse.json(
      { error: "TIKTOK_APP_ID and TIKTOK_REDIRECT_URI must be configured" },
      { status: 500 }
    );
  }

  const workspaceId = req.nextUrl.searchParams.get("workspace_id") || "";
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id is required" }, { status: 400 });
  }

  // CSRF: random nonce in the cookie, full state = nonce:workspaceId in the URL.
  const csrf = crypto.randomBytes(16).toString("hex");
  const stateParam = `${csrf}:${workspaceId}`;

  let url: URL;
  if (authUrl) {
    url = new URL(authUrl);
    url.searchParams.set("state", stateParam);
    // Ensure the redirect_uri matches what we registered, even if the portal URL omits it.
    if (!url.searchParams.get("redirect_uri")) {
      url.searchParams.set("redirect_uri", redirectUri);
    }
  } else {
    if (!rid) {
      return NextResponse.json(
        {
          error:
            "Configure TIKTOK_AUTH_URL (recomendado, copie do portal) ou TIKTOK_AUTH_RID para montar a URL de autorizacao.",
        },
        { status: 500 }
      );
    }
    url = new URL("https://business-api.tiktok.com/portal/auth");
    url.searchParams.set("app_id", appId);
    url.searchParams.set("rid", rid);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", stateParam);
  }

  const res = NextResponse.redirect(url.toString());
  res.cookies.set("tiktok_oauth_state", csrf, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min
  });
  return res;
}
