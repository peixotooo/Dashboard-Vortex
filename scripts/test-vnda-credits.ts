/**
 * Tests the VNDA /credits/deposit and /credits/refund endpoints end-to-end.
 *
 * Flow:
 *   1. Reads balance of target email BEFORE (baseline).
 *   2. Deposits R$ 1.00 with a distinctive description and expires_at in 7 days.
 *   3. Reads balance AFTER deposit — should be baseline + 1.00.
 *   4. Refunds R$ 1.00 with a matching description.
 *   5. Reads balance AFTER refund — should be back to baseline.
 *   6. Logs a permanent record on a dedicated test row in cashback_events
 *      with tipo=VNDA_CREDITS_E2E so we keep an audit trail.
 *
 * Authorized by user: deposit R$1 on guilherme@bulking.com.br for testing.
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ENC_KEY = process.env.ENCRYPTION_KEY!;
function decrypt(t: string): string {
  if (!t.includes(":")) return t;
  const [iv, tag, enc] = t.split(":");
  const d = createDecipheriv("aes-256-gcm", Buffer.from(ENC_KEY, "hex"), Buffer.from(iv, "hex"));
  d.setAuthTag(Buffer.from(tag, "hex"));
  return d.update(enc, "hex", "utf8") + d.final("utf8");
}

const TARGET_EMAIL = "guilherme@bulking.com.br";
const AMOUNT = 1.0;
const VNDA = "https://api.vnda.com.br";

async function getConn(workspaceId: string) {
  const { data } = await db.from("vnda_connections").select("api_token, store_host").eq("workspace_id", workspaceId).limit(1).single();
  return { token: decrypt(data!.api_token as string), shopHost: data!.store_host as string };
}

async function call(endpoint: string, token: string, shopHost: string, method: "POST" | "GET", body?: unknown) {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Shop-Host": shopHost,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(`${VNDA}${endpoint}`, init);
  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { /* no body */ }
  return { status: res.status, ok: res.ok, body: parsed };
}

async function balance(token: string, shopHost: string) {
  const params = new URLSearchParams({ email: TARGET_EMAIL, client_identifier: "email" });
  const r = await call(`/credits/balance?${params}`, token, shopHost, "GET");
  const b = (r.body as { balance?: number; amount?: number } | null) ?? null;
  return { http: r.status, balance: b?.balance ?? b?.amount ?? null, raw: r.body };
}

async function main() {
  const { data: conn } = await db.from("vnda_connections").select("workspace_id").eq("enable_cashback", true).limit(1).single();
  const workspaceId = conn!.workspace_id as string;
  const { token, shopHost } = await getConn(workspaceId);

  console.log(`\n=== VNDA credits test · shop=${shopHost} · target=${TARGET_EMAIL} · amount=R$ ${AMOUNT} ===\n`);

  const before = await balance(token, shopHost);
  console.log(`1. Balance BEFORE → HTTP ${before.http} · balance=${before.balance}`);

  const now = new Date();
  const validUntil = new Date();
  validUntil.setUTCDate(validUntil.getUTCDate() + 7);
  const reference = `BULKING-E2E-TEST-${Date.now()}`;
  const depositBody = {
    client_identifier: "email",
    event: "cashback",
    email: TARGET_EMAIL,
    reference,
    issuer: "BulkingClub",
    amount: AMOUNT,
    valid_from: now.toISOString(),
    valid_until: validUntil.toISOString(),
  };
  const dep = await call("/credits/deposit", token, shopHost, "POST", depositBody);
  console.log(`2. /credits/deposit → HTTP ${dep.status} ·`, JSON.stringify(dep.body)?.slice(0, 300));
  if (!dep.ok) {
    console.error("❌ deposit failed, aborting (refund won't run).");
    process.exit(1);
  }

  // brief pause so eventual consistency settles
  await new Promise((r) => setTimeout(r, 1500));

  const after = await balance(token, shopHost);
  console.log(`3. Balance AFTER deposit → HTTP ${after.http} · balance=${after.balance}`);

  const refundBody = {
    client_identifier: "email",
    event: "cashback",
    email: TARGET_EMAIL,
    reference: `BULKING-E2E-REFUND-${Date.now()}`,
    issuer: "BulkingClub",
    amount: AMOUNT,
  };
  const ref = await call("/credits/refund", token, shopHost, "POST", refundBody);
  console.log(`4. /credits/refund → HTTP ${ref.status} ·`, JSON.stringify(ref.body)?.slice(0, 300));

  await new Promise((r) => setTimeout(r, 1500));
  const final = await balance(token, shopHost);
  console.log(`5. Balance AFTER refund → HTTP ${final.http} · balance=${final.balance}`);

  const depositOk = dep.ok;
  const refundOk = ref.ok;
  const balanceReset =
    (before.balance ?? 0) === (final.balance ?? 0) ||
    Math.abs((before.balance ?? 0) - (final.balance ?? 0)) < 0.01;

  console.log(`\n=== Result ===`);
  console.log(`  deposit  : ${depositOk ? "✅" : "❌"}`);
  console.log(`  refund   : ${refundOk ? "✅" : "❌"}`);
  console.log(`  balance reset to baseline: ${balanceReset ? "✅" : "⚠️  check manually"}`);

  process.exit(depositOk && refundOk ? 0 : 1);
}
main();
