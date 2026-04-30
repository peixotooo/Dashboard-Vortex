/**
 * Create "Magion" workspace for guilherme@bulking.com.br and connect Meta Ads.
 *
 * Usage: npx tsx scripts/create-magion-workspace.ts
 *
 * Required env (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (bypasses RLS)
 *   ENCRYPTION_KEY              (64-hex chars for token encryption)
 *   META_API_VERSION            (optional, defaults v23.0)
 */

import * as fs from "fs";
import * as path from "path";
import { createCipheriv, randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";

// ---- Load .env.local into process.env ----
const envPath = path.resolve(__dirname, "../.env.local");
fs.readFileSync(envPath, "utf8")
  .split("\n")
  .forEach((line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  });

// ---- Config ----
const TARGET_EMAIL = "guilherme@bulking.com.br";
const WORKSPACE_NAME = "Magion";
const WORKSPACE_SLUG = "magion";
const META_APP_ID = "1876707922982979"; // Magion Ai
const META_ACCESS_TOKEN =
  "EAAaq2x0YuEMBRaqZAfH4jBpEZBZAsH9N4BsitFcesReZCZBimq2YJqFXlrHR2hZBrLKTWQXAeb1v6331aqzm2O9Qonh2X05sjkrS3AZCZAWJjMjCdQsWT0YlLDWHBBn9bskeeundmQX0YNqHaAGZBd3bXr8XgpqcbXkaYhj1NZBslJ49oUEwY3BRPxBqPiNkST";
const API_VERSION = process.env.META_API_VERSION || "v23.0";

// ---- Encryption (mirrors src/lib/encryption.ts) ----
function encrypt(text: string): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 64) {
    throw new Error("ENCRYPTION_KEY missing or not 64-hex-chars");
  }
  const keyBuf = Buffer.from(key, "hex");
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", keyBuf, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

// ---- Supabase admin client ----
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ---- Meta Graph helper ----
async function graph(pathname: string, params: Record<string, string> = {}) {
  const url = new URL(`https://graph.facebook.com/${API_VERSION}${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", META_ACCESS_TOKEN);
  const res = await fetch(url.toString());
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Meta API ${pathname} → ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  console.log("1. Looking up profile for", TARGET_EMAIL);
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("email", TARGET_EMAIL)
    .single();

  if (pErr || !profile) {
    throw new Error(`Profile not found: ${pErr?.message || "no match"}`);
  }
  console.log("   → profile.id =", profile.id);

  // -------- 2. Workspace (upsert by slug) --------
  console.log("2. Ensuring workspace", `"${WORKSPACE_NAME}"`);
  let workspaceId: string;
  const { data: existingWs } = await supabase
    .from("workspaces")
    .select("id, owner_id")
    .eq("slug", WORKSPACE_SLUG)
    .maybeSingle();

  if (existingWs) {
    workspaceId = existingWs.id;
    console.log("   → already exists, id =", workspaceId);
  } else {
    const { data: newWs, error: wsErr } = await supabase
      .from("workspaces")
      .insert({
        name: WORKSPACE_NAME,
        slug: WORKSPACE_SLUG,
        owner_id: profile.id,
      })
      .select("id")
      .single();
    if (wsErr || !newWs) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
    workspaceId = newWs.id;
    console.log("   → created, id =", workspaceId);
  }

  // -------- 3. Membership (owner) --------
  console.log("3. Ensuring owner membership");
  const { error: memErr } = await supabase
    .from("workspace_members")
    .upsert(
      { workspace_id: workspaceId, user_id: profile.id, role: "owner" },
      { onConflict: "workspace_id,user_id" }
    );
  if (memErr) throw new Error(`Failed to create membership: ${memErr.message}`);
  console.log("   → ok");

  // -------- 4. Meta connection (encrypted) --------
  console.log("4. Saving Meta connection (encrypted token)");
  const encryptedToken = encrypt(META_ACCESS_TOKEN);

  // token expires ~1h for short-lived user token (screenshot: "em cerca de uma hora")
  // We still store whatever Meta reports in debug_token for accuracy.
  let tokenExpiresAt: string | null = null;
  try {
    const debug = await graph("/debug_token", { input_token: META_ACCESS_TOKEN });
    const exp = (debug.data as { expires_at?: number })?.expires_at;
    if (exp && exp > 0) tokenExpiresAt = new Date(exp * 1000).toISOString();
  } catch (e) {
    console.warn("   ! debug_token failed (non-fatal):", (e as Error).message);
  }

  const { data: existingConn } = await supabase
    .from("meta_connections")
    .select("id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  let connectionId: string;
  if (existingConn) {
    const { error } = await supabase
      .from("meta_connections")
      .update({
        access_token: encryptedToken,
        app_id: META_APP_ID,
        user_id: profile.id,
        token_expires_at: tokenExpiresAt,
      })
      .eq("id", existingConn.id);
    if (error) throw new Error(`Update meta_connections: ${error.message}`);
    connectionId = existingConn.id;
    console.log("   → updated existing connection", connectionId);
  } else {
    const { data: ins, error } = await supabase
      .from("meta_connections")
      .insert({
        workspace_id: workspaceId,
        user_id: profile.id,
        access_token: encryptedToken,
        app_id: META_APP_ID,
        token_expires_at: tokenExpiresAt,
      })
      .select("id")
      .single();
    if (error || !ins) throw new Error(`Insert meta_connections: ${error?.message}`);
    connectionId = ins.id;
    console.log("   → inserted", connectionId);
  }
  if (tokenExpiresAt) console.log("   token_expires_at:", tokenExpiresAt);

  // -------- 5. Fetch Meta ad accounts --------
  console.log("5. Fetching ad accounts from Meta Graph API");
  const me = (await graph("/me", { fields: "id,name" })) as { id: string; name: string };
  console.log("   → me =", me.name, `(${me.id})`);

  const accountsRes = (await graph(`/${me.id}/adaccounts`, {
    fields:
      "id,account_id,name,account_status,currency,timezone_name,business_name,amount_spent",
    limit: "100",
  })) as { data?: Array<Record<string, unknown>> };

  const adAccounts = accountsRes.data || [];
  console.log(`   → ${adAccounts.length} ad account(s) found`);
  for (const a of adAccounts) {
    console.log(`     · ${a.id}  ${a.name}  [status=${a.account_status}, currency=${a.currency}]`);
  }

  if (adAccounts.length === 0) {
    console.warn(
      "   ! No ad accounts returned — check that the token's user has access to ad accounts in Business Manager."
    );
  }

  // -------- 6. Persist meta_accounts --------
  console.log("6. Persisting meta_accounts (replacing existing)");
  await supabase.from("meta_accounts").delete().eq("workspace_id", workspaceId);

  if (adAccounts.length > 0) {
    const rows = adAccounts.map((a, i) => ({
      workspace_id: workspaceId,
      connection_id: connectionId,
      account_id: String(a.id),
      account_name: String(a.name || a.id),
      is_default: i === 0,
    }));
    const { error } = await supabase.from("meta_accounts").insert(rows);
    if (error) throw new Error(`Insert meta_accounts: ${error.message}`);
    console.log(`   → inserted ${rows.length}; default = ${rows[0].account_id} (${rows[0].account_name})`);
  }

  console.log("\nAll done.");
  console.log(`Workspace: ${WORKSPACE_NAME} (slug=${WORKSPACE_SLUG}, id=${workspaceId})`);
  console.log(`Owner: ${profile.email}`);
  console.log(`Meta app: ${META_APP_ID}`);
}

main().catch((e) => {
  console.error("\nFAILED:", e.message || e);
  process.exit(1);
});
