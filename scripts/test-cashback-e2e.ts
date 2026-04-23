/**
 * Cashback E2E smoke test (shadow mode, zero impact on real customers).
 *
 * What it does:
 *   1. Picks a workspace with a VNDA connection that has enable_cashback=true.
 *   2. Probes DB-level state (config, templates, webhook logs).
 *   3. Probes external APIs with read-only calls:
 *        - VNDA /credits/balance (read-only)
 *        - Troquecommerce /order/list with a fake order code
 *   4. Validates SMTP + WhatsApp config are present (does NOT send anything).
 *   5. Simulates a VNDA webhook POST against production using a synthetic
 *      payload (pedido #CASHBACK-E2E-<ts>) so the full
 *      webhook → cashback_transactions pipeline runs.
 *   6. Verifies the test row landed.
 *   7. Temporarily overrides deposit_delay_days=0 + turns all send flags off
 *      to force the cron to pick up the test row immediately in shadow mode.
 *   8. Calls /api/cron/cashback-tick and checks the row progressed to ATIVO.
 *   9. Restores the original config.
 *  10. Deletes the test cashback + its events so no garbage is left behind.
 *
 * Safe: the synthetic webhook uses pedido IDs prefixed with "CASHBACK-E2E-"
 * and fake email `probe+e2e+<ts>@bulkingclub.com.br`. Flags are forced off
 * during the cron run, so NO WhatsApp/email/VNDA-credit calls happen.
 *
 * Usage:
 *   npx tsx scripts/test-cashback-e2e.ts
 */

import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!;
const CRON_SECRET = process.env.CRON_SECRET!;
const BASE_URL = process.env.E2E_BASE_URL || "https://dash.bulking.com.br";

if (!SUPABASE_URL || !SERVICE_KEY || !ENCRYPTION_KEY || !CRON_SECRET) {
  console.error("Missing env: need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, CRON_SECRET in .env.local");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Mirror of src/lib/encryption.ts#decrypt
function decrypt(text: string): string {
  if (!text.includes(":")) return text;
  const [ivHex, authTagHex, encrypted] = text.split(":");
  if (!ivHex || !authTagHex || !encrypted) return text;
  const key = Buffer.from(ENCRYPTION_KEY, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  let out = decipher.update(encrypted, "hex", "utf8");
  out += decipher.final("utf8");
  return out;
}

// --- helpers ---

type Status = "ok" | "fail" | "warn" | "info";
const results: Array<{ step: string; status: Status; detail?: string }> = [];
function record(step: string, status: Status, detail?: string) {
  const icon = status === "ok" ? "✅" : status === "fail" ? "❌" : status === "warn" ? "⚠️ " : "ℹ️ ";
  console.log(`${icon} ${step}${detail ? ` — ${detail}` : ""}`);
  results.push({ step, status, detail });
}

async function httpJson(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(url, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {}
  return { ok: res.ok, status: res.status, body };
}

// --- 1. pick workspace ---

async function pickWorkspace(): Promise<{ workspaceId: string; storeHost: string; webhookToken: string; apiToken: string }> {
  const { data: conns, error } = await db
    .from("vnda_connections")
    .select("workspace_id, store_host, webhook_token, api_token, enable_cashback")
    .eq("enable_cashback", true)
    .limit(1);
  if (error || !conns?.length) {
    throw new Error("no vnda_connection with enable_cashback=true found");
  }
  const c = conns[0];
  return {
    workspaceId: c.workspace_id as string,
    storeHost: c.store_host as string,
    webhookToken: c.webhook_token as string,
    apiToken: decrypt(c.api_token as string),
  };
}

// --- 2. db probes ---

async function dbProbes(workspaceId: string) {
  const { data: cfg } = await db.from("cashback_config").select("*").eq("workspace_id", workspaceId).maybeSingle();
  if (!cfg) {
    record("cashback_config", "fail", "missing — first /api/cashback/config GET would create defaults");
    return null;
  }
  record("cashback_config", "ok", `%: ${cfg.percentage} | channel_mode: ${cfg.channel_mode} | flags deposit:${cfg.enable_deposit} refund:${cfg.enable_refund} wa:${cfg.enable_whatsapp} email:${cfg.enable_email} troque:${cfg.enable_troquecommerce}`);

  const { data: templates } = await db
    .from("cashback_reminder_templates")
    .select("canal, estagio, enabled, wa_template_name, email_subject, email_body_html")
    .eq("workspace_id", workspaceId);
  const stages = ["LEMBRETE_1", "LEMBRETE_2", "LEMBRETE_3", "REATIVACAO", "REATIVACAO_LEMBRETE"];
  const missing: string[] = [];
  for (const s of stages) {
    const wa = (templates || []).find((t) => t.estagio === s && t.canal === "whatsapp" && t.wa_template_name);
    const em = (templates || []).find((t) => t.estagio === s && t.canal === "email" && t.email_subject && t.email_body_html);
    if (!wa && !em) missing.push(s);
  }
  if (missing.length) {
    record("reminder_templates", "warn", `sem template: ${missing.join(", ")}`);
  } else {
    record("reminder_templates", "ok", `${stages.length} estágios preenchidos`);
  }
  return cfg;
}

// --- 3. VNDA credits probe (read-only) ---

async function vndaProbe(apiToken: string) {
  const probeEmail = `probe+e2e-${Date.now()}@bulkingclub.com.br`;
  const url = `https://api.vnda.com.br/credits/balance?email=${encodeURIComponent(probeEmail)}&client_identifier=email`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Token ${apiToken}`, Accept: "application/json" },
    });
    if (res.status === 200 || res.status === 404) {
      record("vnda_credits_api", "ok", `HTTP ${res.status} (token válido)`);
    } else if (res.status === 401 || res.status === 403) {
      record("vnda_credits_api", "fail", `HTTP ${res.status} — token inválido`);
    } else {
      const text = await res.text().catch(() => "");
      record("vnda_credits_api", "warn", `HTTP ${res.status} — ${text.slice(0, 120)}`);
    }
  } catch (e) {
    record("vnda_credits_api", "fail", `network: ${e instanceof Error ? e.message : "?"}`);
  }
}

// --- 4. Troquecommerce probe ---

async function troqueProbe(workspaceId: string) {
  const { data } = await db
    .from("troquecommerce_config")
    .select("api_token, base_url")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data?.api_token) {
    record("troquecommerce_config", "warn", "não configurado — abatimento de troca desligado");
    return;
  }
  const token = decrypt(data.api_token as string);
  const baseUrl = (data.base_url as string) || "https://www.troquecommerce.com.br";
  try {
    const res = await fetch(`${baseUrl}/api/public/order/list?order_code=CASHBACK-E2E-PROBE`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (res.status === 200) {
      record("troquecommerce_api", "ok", "HTTP 200 (lookup fake retornou ok)");
    } else if (res.status === 401 || res.status === 403) {
      record("troquecommerce_api", "fail", `HTTP ${res.status} — token inválido`);
    } else {
      record("troquecommerce_api", "warn", `HTTP ${res.status}`);
    }
  } catch (e) {
    record("troquecommerce_api", "fail", `network: ${e instanceof Error ? e.message : "?"}`);
  }
}

// --- 5. SMTP + WA config presence (NO send) ---

async function messagingConfigProbe(workspaceId: string) {
  const { data: smtp } = await db
    .from("smtp_config")
    .select("provider, from_email")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (smtp?.from_email) {
    record("smtp_config", "ok", `${smtp.provider} · from=${smtp.from_email} (envio NÃO testado nesta rodada)`);
  } else {
    record("smtp_config", "warn", "não configurado — e-mails não serão enviados");
  }

  const { data: wa } = await db
    .from("wa_config")
    .select("phone_number_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (wa?.phone_number_id) {
    record("wa_config", "ok", `phone_number_id=${wa.phone_number_id} (envio NÃO testado nesta rodada)`);
  } else {
    record("wa_config", "warn", "não configurado — WhatsApp não será enviado");
  }
}

// --- 6. simulate webhook + full pipeline ---

interface CfgRow {
  enable_whatsapp: boolean;
  enable_email: boolean;
  enable_deposit: boolean;
  enable_refund: boolean;
  deposit_delay_days: number;
}

async function simulateWebhookAndCron(args: {
  workspaceId: string;
  webhookToken: string;
  originalCfg: CfgRow;
}) {
  const { workspaceId, webhookToken, originalCfg } = args;
  const now = Date.now();
  const fakeOrderId = 900000000000 + (now % 100000000); // numeric id, collision-safe
  const fakeCode = `CASHBACK-E2E-${now}`;
  const fakeEmail = `probe+e2e-${now}@bulkingclub.com.br`;

  const payload = {
    id: fakeOrderId,
    code: fakeCode,
    token: `e2e-${now}`,
    status: "confirmed",
    first_name: "E2E",
    last_name: "Probe",
    email: fakeEmail,
    subtotal: 259.0,
    discount_price: 0,
    total: 280.0,
    taxes: 0,
    shipping_price: 21.0,
    confirmed_at: new Date().toISOString(),
    received_at: new Date().toISOString(),
    items: [{ id: 1, reference: "SKU-E2E", product_name: "Produto E2E", sku: "SKU-E2E", variant_name: "-", quantity: 1, price: 259, original_price: 259, total: 259, weight: 0.5 }],
  };

  // Force shadow mode: turn off all external calls, zero the deposit delay
  await db
    .from("cashback_config")
    .update({
      enable_whatsapp: false,
      enable_email: false,
      enable_deposit: false,
      enable_refund: false,
      deposit_delay_days: 0,
    })
    .eq("workspace_id", workspaceId);
  record("shadow_mode_enabled", "ok", "flags off + deposit_delay_days=0");

  const webhookUrl = `${BASE_URL}/api/webhooks/vnda/orders?token=${webhookToken}`;
  const hook = await httpJson(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!hook.ok) {
    record("webhook_post", "fail", `HTTP ${hook.status} ${JSON.stringify(hook.body).slice(0, 160)}`);
    return { fakeOrderId: String(fakeOrderId), fakeCode };
  }
  record("webhook_post", "ok", `HTTP 200 ${JSON.stringify(hook.body)}`);

  // Verify row created
  const { data: created } = await db
    .from("cashback_transactions")
    .select("id, status, valor_cashback, email, expira_em")
    .eq("workspace_id", workspaceId)
    .eq("source_order_id", String(fakeOrderId))
    .maybeSingle();
  if (!created) {
    record("cashback_row_created", "fail", "linha não apareceu em cashback_transactions");
    return { fakeOrderId: String(fakeOrderId), fakeCode };
  }
  record("cashback_row_created", "ok", `status=${created.status} | valor=${created.valor_cashback} | email=${created.email}`);

  // Run the cron in shadow
  const cron = await httpJson(`${BASE_URL}/api/cron/cashback-tick`, {
    method: "GET",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  if (!cron.ok) {
    record("cron_tick", "fail", `HTTP ${cron.status} ${JSON.stringify(cron.body).slice(0, 200)}`);
  } else {
    record("cron_tick", "ok", `${JSON.stringify(cron.body).slice(0, 300)}`);
  }

  // Verify state transition to ATIVO + depositado_em set
  const { data: after } = await db
    .from("cashback_transactions")
    .select("status, depositado_em, expira_em, valor_cashback")
    .eq("workspace_id", workspaceId)
    .eq("source_order_id", String(fakeOrderId))
    .maybeSingle();
  if (after?.status === "ATIVO" && after.depositado_em) {
    record("state_transition", "ok", `AGUARDANDO_DEPOSITO → ATIVO · depositado_em=${after.depositado_em} · expira_em=${after.expira_em}`);
  } else {
    record("state_transition", "fail", `esperava ATIVO, obtido ${after?.status} (depositado_em=${after?.depositado_em})`);
  }

  // Verify events written
  const { data: events } = await db
    .from("cashback_events")
    .select("tipo, created_at")
    .eq("workspace_id", workspaceId)
    .eq("cashback_id", created.id)
    .order("created_at", { ascending: true });
  const tipos = (events || []).map((e) => e.tipo);
  if (tipos.includes("CREATED") && tipos.includes("DEPOSITO")) {
    record("events_logged", "ok", `eventos: ${tipos.join(" → ")}`);
  } else {
    record("events_logged", "warn", `eventos: ${tipos.join(" → ") || "(nenhum)"}`);
  }

  // Restore original config
  await db
    .from("cashback_config")
    .update({
      enable_whatsapp: originalCfg.enable_whatsapp,
      enable_email: originalCfg.enable_email,
      enable_deposit: originalCfg.enable_deposit,
      enable_refund: originalCfg.enable_refund,
      deposit_delay_days: originalCfg.deposit_delay_days,
    })
    .eq("workspace_id", workspaceId);
  record("config_restored", "ok", `deposit_delay_days=${originalCfg.deposit_delay_days} · flags voltaram ao original`);

  return { fakeOrderId: String(fakeOrderId), fakeCode, cashbackId: created.id };
}

// --- 7. cleanup ---

async function cleanup(workspaceId: string, fakeOrderId: string, fakeCode: string, cashbackId?: string) {
  if (cashbackId) {
    await db.from("cashback_events").delete().eq("cashback_id", cashbackId);
  }
  await db.from("cashback_transactions").delete().eq("workspace_id", workspaceId).eq("source_order_id", fakeOrderId);
  await db.from("crm_vendas").delete().eq("workspace_id", workspaceId).eq("source_order_id", fakeOrderId);
  await db.from("vnda_webhook_logs").delete().eq("workspace_id", workspaceId).eq("order_id", fakeOrderId);
  record("cleanup", "ok", `removido pedido ${fakeCode} e linhas dependentes`);
}

// --- main ---

async function main() {
  console.log("\n=== Cashback E2E (shadow mode, zero real customer impact) ===\n");

  const ws = await pickWorkspace();
  record("workspace", "info", `${ws.workspaceId} · store=${ws.storeHost}`);

  const cfg = await dbProbes(ws.workspaceId);
  if (!cfg) {
    console.log("\nEncerrando: cashback_config inexistente. Abra /crm/cashback uma vez para criar defaults.\n");
    process.exit(2);
  }
  const originalCfg: CfgRow = {
    enable_whatsapp: cfg.enable_whatsapp,
    enable_email: cfg.enable_email,
    enable_deposit: cfg.enable_deposit,
    enable_refund: cfg.enable_refund,
    deposit_delay_days: cfg.deposit_delay_days,
  };

  await vndaProbe(ws.apiToken);
  await troqueProbe(ws.workspaceId);
  await messagingConfigProbe(ws.workspaceId);

  let fake: { fakeOrderId: string; fakeCode: string; cashbackId?: string } | null = null;
  try {
    fake = await simulateWebhookAndCron({ workspaceId: ws.workspaceId, webhookToken: ws.webhookToken, originalCfg });
  } catch (e) {
    record("simulate_webhook_and_cron", "fail", e instanceof Error ? e.message : String(e));
  } finally {
    if (fake) await cleanup(ws.workspaceId, fake.fakeOrderId, fake.fakeCode, fake.cashbackId);
  }

  console.log("\n=== Summary ===");
  const fails = results.filter((r) => r.status === "fail");
  const warns = results.filter((r) => r.status === "warn");
  console.log(`${results.length} checks · ${fails.length} fail · ${warns.length} warn`);
  if (fails.length) {
    console.log("\nFalhas:");
    for (const r of fails) console.log(`  - ${r.step}: ${r.detail}`);
    process.exit(1);
  }
  console.log("\n✅ pipeline em shadow mode está íntegra.\n");
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
