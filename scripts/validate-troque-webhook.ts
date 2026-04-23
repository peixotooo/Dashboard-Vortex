/**
 * Post-deploy validation of the Troquecommerce webhook:
 *   1. Confirms troquecommerce_config.webhook_token exists for the workspace
 *   2. Prints the URL so you can paste it into the Troquecommerce panel
 *   3. Fires a DRY-RUN synthetic payload (ecommerce_number that doesn't match
 *      any real cashback) — expected result: status="no_cashback_for_order"
 *      (proves auth + payload parsing work without touching anything)
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const BASE_URL = process.env.E2E_BASE_URL || "https://dash.bulking.com.br";

async function main() {
  const { data: conn } = await db
    .from("vnda_connections")
    .select("workspace_id")
    .eq("enable_cashback", true)
    .limit(1)
    .single();
  const workspaceId = conn!.workspace_id as string;

  const { data: troque } = await db
    .from("troquecommerce_config")
    .select("webhook_token, base_url")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!troque?.webhook_token) {
    console.error("❌ troquecommerce_config.webhook_token não encontrado — salve o token pelo painel primeiro");
    process.exit(1);
  }

  const webhookUrl = `${BASE_URL}/api/webhooks/troquecommerce?token=${troque.webhook_token}`;
  console.log(`\n✅ Webhook URL (cole no painel Troquecommerce):\n   ${webhookUrl}\n`);

  // Synthetic payload mirroring the shape Troquecommerce sends, but with
  // ecommerce_number that we know won't match any real cashback row.
  const payload = {
    id: `validate-${Date.now()}`,
    ecommerce_number: "NAO-EXISTE-CASHBACK-E2E",
    status: "Em Trânsito",
    reverse_type: "Devolução",
    client: { email: "diagnostic@bulkingclub.com.br", name: "Diagnostic" },
    price: 99.9,
    exchange_value: 0,
    refund_value: 99.9,
    items: [],
  };

  console.log("→ Firing synthetic webhook (expected: no_cashback_for_order)");
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  console.log(`→ HTTP ${res.status}  ${JSON.stringify(body)}`);

  // Confirm the log landed
  await new Promise((r) => setTimeout(r, 500));
  const { data: log } = await db
    .from("troquecommerce_webhook_logs")
    .select("status, ecommerce_number, created_at")
    .eq("workspace_id", workspaceId)
    .eq("external_id", payload.id)
    .single();

  console.log(`\n→ Log row: ${JSON.stringify(log)}`);

  if (res.ok && body?.status === "no_cashback_for_order" && log?.status === "no_cashback") {
    console.log("\n✅ Webhook do Troquecommerce está respondendo, parseando payload, e gravando auditoria corretamente.");
    console.log("   Próximo passo: cole a URL acima no painel Troquecommerce.");
  } else {
    console.log("\n⚠️  Resposta não bateu com o esperado. Verifique acima.");
  }
}
main();
