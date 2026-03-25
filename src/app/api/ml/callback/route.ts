import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { encrypt } from "@/lib/encryption";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") || "";

  if (!code) {
    return NextResponse.json({ error: "No code received" }, { status: 400 });
  }

  // Extract workspace_id from state param (state:workspaceId)
  const parts = state.split(":");
  const workspaceId = parts.length > 1 ? parts.slice(1).join(":") : "";

  if (!workspaceId) {
    return NextResponse.redirect(
      new URL("/hub?error=missing_workspace", req.url)
    );
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
    return NextResponse.redirect(
      new URL("/hub?error=token_exchange_failed", req.url)
    );
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
    return NextResponse.redirect(
      new URL("/hub?error=db_save_failed", req.url)
    );
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

  return NextResponse.redirect(new URL("/hub", req.url));
}
