/**
 * Re-validates the Troquecommerce webhook using the EXACT payload shape
 * the partner shared (status "Finalizado", reverse_type "Troca e devolução"),
 * but with an ecommerce_number that doesn't match any real cashback — so
 * we prove auth + parsing + status matching without touching real data.
 *
 * Expected response: status="no_cashback_for_order"
 * (previously, "Finalizado" would have given "ignored_status" — bug fixed)
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
    .select("workspace_id")
    .eq("enable_cashback", true)
    .limit(1)
    .single();
  const workspaceId = conn!.workspace_id as string;

  const { data: troque } = await db
    .from("troquecommerce_config")
    .select("webhook_token")
    .eq("workspace_id", workspaceId)
    .single();

  const webhookUrl = `${BASE_URL}/api/webhooks/troquecommerce?token=${troque!.webhook_token}`;

  // Payload with REAL-shape status "Finalizado" but fake ecommerce_number
  const payload = {
    id: `validate-finalizado-${Date.now()}`,
    ecommerce_number: "NAO-EXISTE-CASHBACK-FIN-PROBE",
    replaced_order_ecommerce_number: "XXXXX-01",
    status: "Finalizado",
    reverse_type: "Troca e devolução",
    client: { email: "probe@bulkingclub.com.br", name: "Probe" },
    price: 2086,
    exchange_value: 453.36,
    refund_value: 1632.64,
    discount: 210,
    order_shipping_cost: 0,
    retained_value: 599.99,
    coupon_used_on_order: "FAKE-COUPON",
    items: [],
    sellers: ["fakeseller01"],
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  console.log(`HTTP ${res.status} ${JSON.stringify(body)}`);

  await new Promise((r) => setTimeout(r, 500));
  const { data: log } = await db
    .from("troquecommerce_webhook_logs")
    .select("status, ecommerce_number, reverse_type")
    .eq("workspace_id", workspaceId)
    .eq("external_id", payload.id)
    .single();
  console.log(`Log: ${JSON.stringify(log)}`);

  const responseOk = res.ok && body?.status === "no_cashback_for_order";
  const logOk = log?.status === "no_cashback";
  const statusMatchFixed = logOk; // se fosse bug antigo, log seria "ignored_status"

  console.log(
    responseOk && logOk
      ? "\n✅ Status 'Finalizado' reconhecido corretamente + auditoria gravada (bug de gender match corrigido)."
      : "\n❌ Algo não bateu."
  );
  process.exit(responseOk && logOk ? 0 : 1);
}
main();
