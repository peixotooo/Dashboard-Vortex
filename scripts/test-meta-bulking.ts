import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../src/lib/encryption";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log("\n=== 1. Workspaces matching 'bulking' ===");
  const { data: workspaces, error: wsErr } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .or("name.ilike.%bulking%,slug.ilike.%bulking%");
  if (wsErr) {
    console.error("workspaces query error:", wsErr);
    return;
  }
  console.log(workspaces);

  if (!workspaces || workspaces.length === 0) {
    console.log("No bulking workspace found. Listing all workspaces:");
    const { data: all } = await supabase.from("workspaces").select("id, name, slug").limit(20);
    console.log(all);
    return;
  }

  for (const ws of workspaces) {
    console.log(`\n=== 2. meta_connections for workspace ${ws.name} (${ws.id}) ===`);
    const { data: conns, error: connErr } = await supabase
      .from("meta_connections")
      .select("id, workspace_id, access_token, created_at")
      .eq("workspace_id", ws.id)
      .order("created_at", { ascending: false });
    if (connErr) {
      console.error("meta_connections error:", connErr);
      continue;
    }
    console.log(`Found ${conns?.length ?? 0} connection(s)`);
    if (!conns || conns.length === 0) continue;

    const conn = conns[0];
    console.log(`Latest connection id=${conn.id} created_at=${conn.created_at}`);
    console.log(`access_token (encrypted) length=${conn.access_token?.length ?? 0}`);

    let token: string;
    try {
      token = decrypt(conn.access_token);
      console.log(`Decrypted token prefix: ${token.slice(0, 12)}... length=${token.length}`);
    } catch (e: any) {
      console.error("DECRYPT FAILED:", e.message);
      continue;
    }

    console.log(`\n=== 3. Hitting Meta Graph API /me with bulking token ===`);
    const meRes = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
    const meBody = await meRes.text();
    console.log(`status=${meRes.status}`);
    console.log(meBody);

    console.log(`\n=== 4. Hitting /me/adaccounts ===`);
    const aaRes = await fetch(
      `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,account_status,currency&limit=10&access_token=${encodeURIComponent(token)}`
    );
    const aaBody = await aaRes.text();
    console.log(`status=${aaRes.status}`);
    console.log(aaBody);

    console.log(`\n=== 5. Token debug (debug_token) ===`);
    const dbgRes = await fetch(
      `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`
    );
    console.log(`status=${dbgRes.status}`);
    console.log(await dbgRes.text());

    console.log(`\n=== 6. meta_accounts saved for this workspace ===`);
    const { data: savedAccounts } = await supabase
      .from("meta_accounts")
      .select("account_id, account_name, is_default, created_at")
      .eq("workspace_id", ws.id);
    console.log(savedAccounts);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
