/**
 * Read-only balance check for guilherme@bulking.com.br to confirm the
 * E2E deposit+refund pair netted to zero. If total_available went up by 1.00
 * since the pre-test baseline (6.01), refund failed to match the deposit
 * and a cleanup withdrawal is needed.
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const ENC_KEY = process.env.ENCRYPTION_KEY!;
function decrypt(t: string): string {
  if (!t.includes(":")) return t;
  const [iv, tag, enc] = t.split(":");
  const d = createDecipheriv("aes-256-gcm", Buffer.from(ENC_KEY, "hex"), Buffer.from(iv, "hex"));
  d.setAuthTag(Buffer.from(tag, "hex"));
  return d.update(enc, "hex", "utf8") + d.final("utf8");
}

async function main() {
  const { data: conn } = await db.from("vnda_connections").select("api_token, store_host").eq("enable_cashback", true).limit(1).single();
  const token = decrypt(conn!.api_token as string);
  const shopHost = conn!.store_host as string;

  const params = new URLSearchParams({ email: "guilherme@bulking.com.br", client_identifier: "email" });
  const res = await fetch(`https://api.vnda.com.br/credits/balance?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Shop-Host": shopHost,
      Accept: "application/json",
    },
  });
  const body = await res.json().catch(() => null);
  console.log(`HTTP ${res.status}  ${JSON.stringify(body)}`);

  // Also list recent credits to inspect
  const list = await fetch(`https://api.vnda.com.br/credits?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Shop-Host": shopHost,
      Accept: "application/json",
    },
  });
  const listBody = await list.json().catch(() => null);
  console.log(`\nGET /credits HTTP ${list.status}:`);
  console.log(JSON.stringify(listBody, null, 2).slice(0, 2000));
}
main();
