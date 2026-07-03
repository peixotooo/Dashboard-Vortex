/**
 * Validates the bulking-club exclusion end-to-end against the live VNDA
 * webhook endpoint:
 *
 *   1. Reads cashback_config.excluded_client_tags from DB (proof migration ran)
 *   2. Fires synthetic webhook A with client_tags="bulking-club" + common coupon
 *      → expected: cashback_transaction row IS created
 *   3. Fires synthetic webhook B with client_tags="bulking-club" + VIP/Club coupon
 *      → expected: NO cashback_transaction row created
 *   4. Fires synthetic webhook C with client_tags="optin-checkout"
 *      → expected: cashback_transaction row IS created
 *   5. Cleans up synthetic rows
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const BASE_URL = "https://dash.bulking.com.br";

async function main() {
  const { data: conn } = await db
    .from("vnda_connections")
    .select("workspace_id, webhook_token")
    .eq("enable_cashback", true)
    .limit(1)
    .single();
  const workspaceId = conn!.workspace_id as string;
  const webhookToken = conn!.webhook_token as string;

  // === 1. Confirm migration ran ===
  const { data: cfg } = await db
    .from("cashback_config")
    .select("excluded_client_tags")
    .eq("workspace_id", workspaceId)
    .single();
  const excluded = cfg?.excluded_client_tags as string[] | null | undefined;
  if (!excluded || excluded.length === 0) {
    console.log("❌ cashback_config.excluded_client_tags está vazio — migration 057 não foi aplicada ou os valores não foram populados");
    process.exit(1);
  }
  console.log(`✅ cashback_config.excluded_client_tags = ${JSON.stringify(excluded)}`);

  const webhookUrl = `${BASE_URL}/api/webhooks/vnda/orders?token=${webhookToken}`;

  function makePayload(suffix: string, tags: string | null, couponCode: string | null = null) {
    const orderId = 990000000000 + Math.floor(Math.random() * 1_000_000_000);
    return {
      orderId,
      payload: {
        id: orderId,
        code: `CLUB-FILTER-TEST-${suffix}`,
        token: `t-${Date.now()}`,
        status: "confirmed",
        first_name: "Filter",
        last_name: "Probe",
        email: `probe+club-filter-${suffix}-${Date.now()}@bulkingclub.com.br`,
        client_tags: tags,
        subtotal: 100,
        total: 110,
        taxes: 0,
        shipping_price: 10,
        coupon_code: couponCode,
        discount_price: couponCode ? 12 : 0,
        confirmed_at: new Date().toISOString(),
        items: [{ id: 1, reference: "X", product_name: "X", sku: "X", variant_name: "-", quantity: 1, price: 100, original_price: 100, total: 100, weight: 0.5 }],
      },
    };
  }

  // === 2. Club member + common coupon → must create ===
  console.log("\n→ Cenário A: client_tags=\"bulking-club\" + cupom comum BKOFF12 (deve criar)");
  const a = makePayload("club-common", "bulking-club", "BKOFF12");
  const resA = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(a.payload),
  });
  const bodyA = await resA.json().catch(() => null);
  console.log(`   HTTP ${resA.status}  ${JSON.stringify(bodyA)}`);

  await new Promise((r) => setTimeout(r, 800));
  const { data: createdA } = await db
    .from("cashback_transactions")
    .select("id, status, valor_cashback")
    .eq("workspace_id", workspaceId)
    .eq("source_order_id", String(a.orderId))
    .maybeSingle();

  if (createdA) {
    console.log(`   ✅ Cashback criado · id=${createdA.id} · valor=R$${createdA.valor_cashback} · status=${createdA.status}`);
  } else {
    console.log("   ❌ FALHA: club + cupom comum não deveria bloquear cashback");
  }

  // === 3. Club member + VIP/Club coupon → must NOT create ===
  console.log("\n→ Cenário B: client_tags=\"bulking-club\" + cupom COPAVIP (deve bloquear)");
  const b = makePayload("club-vip", "bulking-club", "COPAVIP");
  const resB = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b.payload),
  });
  const bodyB = await resB.json().catch(() => null);
  console.log(`   HTTP ${resB.status}  ${JSON.stringify(bodyB)}`);

  await new Promise((r) => setTimeout(r, 800));
  const { data: createdB } = await db
    .from("cashback_transactions")
    .select("id, status, valor_cashback")
    .eq("workspace_id", workspaceId)
    .eq("source_order_id", String(b.orderId))
    .maybeSingle();

  if (createdB) {
    console.log(`   ❌ FALHA: cashback foi criado mesmo com cupom VIP/Club (id=${createdB.id})`);
  } else {
    console.log("   ✅ NENHUM cashback_transaction criado — filtro bloqueou corretamente");
  }

  // === 4. Non-club tagged webhook → must create ===
  console.log("\n→ Cenário C: client_tags=\"optin-checkout\" (deve criar)");
  const c = makePayload("nonclub", "optin-checkout");
  const resC = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(c.payload),
  });
  const bodyC = await resC.json().catch(() => null);
  console.log(`   HTTP ${resC.status}  ${JSON.stringify(bodyC)}`);

  await new Promise((r) => setTimeout(r, 800));
  const { data: createdC } = await db
    .from("cashback_transactions")
    .select("id, status, valor_cashback")
    .eq("workspace_id", workspaceId)
    .eq("source_order_id", String(c.orderId))
    .maybeSingle();

  if (createdC) {
    console.log(`   ✅ Cashback criado · id=${createdC.id} · valor=R$${createdC.valor_cashback} · status=${createdC.status}`);
  } else {
    console.log("   ❌ FALHA: nenhum cashback criado mesmo com cliente não-Club");
  }

  // === 5. Cleanup ===
  console.log("\n→ Cleanup");
  for (const row of [createdA, createdB, createdC].filter(Boolean) as Array<{ id: string }>) {
    await db.from("cashback_events").delete().eq("cashback_id", row.id);
    await db.from("cashback_transactions").delete().eq("id", row.id);
  }
  await db.from("crm_vendas").delete().eq("workspace_id", workspaceId).in("source_order_id", [String(a.orderId), String(b.orderId), String(c.orderId)]);
  await db.from("vnda_webhook_logs").delete().eq("workspace_id", workspaceId).in("order_id", [String(a.orderId), String(b.orderId), String(c.orderId)]);
  console.log("   ✅ rows synthetic removidas\n");

  const okA = !!createdA;
  const okB = !createdB;
  const okC = !!createdC;
  if (okA && okB && okC) {
    console.log("✅ Filtro do Club valido em produção — cupom comum passa, cupom VIP/Club bloqueia.");
    process.exit(0);
  }
  console.log("❌ Algum cenário falhou — investigar.");
  process.exit(1);
}
main();
