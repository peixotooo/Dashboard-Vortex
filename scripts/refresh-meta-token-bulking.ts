import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { encrypt } from "../src/lib/encryption";

config({ path: ".env.local" });

const SHORT_TOKEN = process.argv[2];
if (!SHORT_TOKEN) {
  console.error("Usage: tsx scripts/refresh-meta-token-bulking.ts <short_lived_token>");
  process.exit(1);
}

const APP_ID = process.env.META_APP_ID!;
const APP_SECRET = process.env.META_APP_SECRET!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const WORKSPACE_ID = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";

async function main() {
  console.log("=== 1. Validating provided short-lived token ===");
  const meRes = await fetch(
    `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(SHORT_TOKEN)}`
  );
  const meBody = await meRes.json();
  if (!meRes.ok) {
    console.error("Token invalid:", meBody);
    process.exit(1);
  }
  console.log("Token user:", meBody);

  console.log("\n=== 2. Exchanging for long-lived token (60 days) ===");
  const exchUrl =
    `https://graph.facebook.com/v21.0/oauth/access_token` +
    `?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(APP_ID)}` +
    `&client_secret=${encodeURIComponent(APP_SECRET)}` +
    `&fb_exchange_token=${encodeURIComponent(SHORT_TOKEN)}`;
  const exchRes = await fetch(exchUrl);
  const exchBody = await exchRes.json();
  if (!exchRes.ok || !exchBody.access_token) {
    console.error("Exchange failed:", exchBody);
    process.exit(1);
  }
  const longToken: string = exchBody.access_token;
  const expiresIn: number = exchBody.expires_in ?? 0;
  console.log(`Got long-lived token (length=${longToken.length}, expires_in=${expiresIn}s ≈ ${Math.round(expiresIn / 86400)} days)`);

  console.log("\n=== 3. Sanity check: /me/adaccounts with new token ===");
  const aaRes = await fetch(
    `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,account_status&limit=20&access_token=${encodeURIComponent(longToken)}`
  );
  const aaBody = await aaRes.json();
  if (!aaRes.ok) {
    console.error("adaccounts call failed:", aaBody);
    process.exit(1);
  }
  console.log(`Returned ${aaBody.data?.length ?? 0} ad accounts`);
  console.log(JSON.stringify(aaBody.data?.slice(0, 5), null, 2));

  console.log("\n=== 4. Encrypting and updating meta_connections for Bulking workspace ===");
  const encrypted = encrypt(longToken);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: existing, error: selErr } = await supabase
    .from("meta_connections")
    .select("id, created_at")
    .eq("workspace_id", WORKSPACE_ID)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (selErr || !existing) {
    console.error("No existing meta_connections row to update:", selErr);
    process.exit(1);
  }

  const { error: updErr } = await supabase
    .from("meta_connections")
    .update({ access_token: encrypted })
    .eq("id", existing.id);

  if (updErr) {
    console.error("Update failed:", updErr);
    process.exit(1);
  }
  console.log(`Updated meta_connections.id=${existing.id}`);

  console.log("\n=== 5. Re-test through decrypt path ===");
  const { decrypt } = await import("../src/lib/encryption");
  const { data: verify } = await supabase
    .from("meta_connections")
    .select("access_token")
    .eq("id", existing.id)
    .single();
  const roundTrip = decrypt(verify!.access_token);
  console.log(`Round-trip ok: ${roundTrip === longToken ? "YES" : "NO"}`);

  console.log("\n✅ Done. Refresh the dashboard — Meta Ads should return data now.");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
