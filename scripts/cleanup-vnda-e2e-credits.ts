/**
 * Cleans up orphan E2E test credits left in guilherme@bulking.com.br's
 * VNDA wallet by previous test runs. Calls /credits/refund with the EXACT
 * reference of each BULKING-E2E-TEST-* credit — this validates the
 * hypothesis that VNDA's refund matches on reference.
 *
 * Verifies net-zero afterwards.
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

const TARGET = "guilherme@bulking.com.br";

async function main() {
  const { data: conn } = await db.from("vnda_connections").select("api_token, store_host").eq("enable_cashback", true).limit(1).single();
  const token = decrypt(conn!.api_token as string);
  const shopHost = conn!.store_host as string;

  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Shop-Host": shopHost,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // 1. List credits, find orphan E2E ones
  const listRes = await fetch(`https://api.vnda.com.br/credits?email=${encodeURIComponent(TARGET)}&client_identifier=email`, { headers });
  const credits = (await listRes.json()) as Array<{ id: number; reference: string; amount: number; issuer: string }>;

  const orphans = credits.filter((c) => c.reference.startsWith("BULKING-E2E-TEST-"));
  console.log(`Encontrados ${orphans.length} créditos órfãos de teste:`);
  for (const o of orphans) console.log(`  - ${o.reference}  R$ ${o.amount}`);

  if (orphans.length === 0) {
    console.log("\nNada a limpar. ✅");
    return;
  }

  // 2. Read balance before
  const balBefore = await (await fetch(`https://api.vnda.com.br/credits/balance?email=${encodeURIComponent(TARGET)}&client_identifier=email`, { headers })).json();
  console.log(`\nBalance antes:  ${JSON.stringify(balBefore)}`);

  // 3. Refund each with MATCHING reference
  for (const o of orphans) {
    const body = {
      client_identifier: "email",
      event: "cashback",
      email: TARGET,
      reference: o.reference,              // ← match exato do deposit
      issuer: "BulkingClub",
      amount: o.amount,
    };
    const res = await fetch("https://api.vnda.com.br/credits/refund", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const rbody = await res.text();
    console.log(`\nRefund ${o.reference} → HTTP ${res.status}  ${rbody.slice(0, 200)}`);
  }

  // 4. Verify balance after
  await new Promise((r) => setTimeout(r, 1500));
  const balAfter = await (await fetch(`https://api.vnda.com.br/credits/balance?email=${encodeURIComponent(TARGET)}&client_identifier=email`, { headers })).json();
  console.log(`\nBalance depois: ${JSON.stringify(balAfter)}`);

  // 5. Verify the credits are gone
  const listAfter = (await (await fetch(`https://api.vnda.com.br/credits?email=${encodeURIComponent(TARGET)}&client_identifier=email`, { headers })).json()) as Array<{ reference: string }>;
  const stillThere = listAfter.filter((c) => c.reference.startsWith("BULKING-E2E-TEST-"));
  console.log(`\nE2E credits ainda ativos: ${stillThere.length}`);
  if (stillThere.length === 0) console.log("✅ Limpeza completa.");
}
main();
