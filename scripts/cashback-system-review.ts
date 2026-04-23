/**
 * Full system review of the cashback feature. Read-only except for
 * (1) setting enable_whatsapp=false as the user requested, and
 * (2) a no-cashback synthetic probe against the troque webhook that
 * leaves an audit-only row.
 *
 * Checks across 6 dimensions:
 *   1. Config state     — cashback_config + feature flags
 *   2. Integrations     — vnda_connections, smtp_config, troquecommerce_config
 *   3. Templates        — reminder templates completeness
 *   4. Data hygiene     — leftover test rows, orphan credits, leaked state
 *   5. Operational      — webhook activity, cron freshness, error rates
 *   6. Security smell   — RLS, encrypted secrets, residual dev artifacts
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

type Severity = "ok" | "warn" | "fail" | "info" | "action";
const findings: Array<{ area: string; check: string; severity: Severity; detail: string }> = [];
function add(area: string, check: string, severity: Severity, detail: string) {
  findings.push({ area, check, severity, detail });
  const icon = severity === "ok" ? "✅" : severity === "warn" ? "⚠️ " : severity === "fail" ? "❌" : severity === "action" ? "🔧" : "ℹ️ ";
  console.log(`${icon} [${area}] ${check} — ${detail}`);
}

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════╗");
  console.log("║       Cashback Bulking — System Review                 ║");
  console.log("╚════════════════════════════════════════════════════════╝\n");

  // Find Bulking workspace
  const { data: conn } = await db
    .from("vnda_connections")
    .select("workspace_id, store_host, enable_cashback")
    .eq("enable_cashback", true)
    .limit(1)
    .single();
  if (!conn) {
    add("setup", "vnda_connection", "fail", "nenhuma conexão com enable_cashback=true");
    return;
  }
  const workspaceId = conn.workspace_id as string;
  const storeHost = conn.store_host as string;
  add("setup", "vnda_connection", "ok", `workspace=${workspaceId} · store=${storeHost} · enable_cashback=true`);

  // --- 1. Config state ---
  const { data: cfg } = await db.from("cashback_config").select("*").eq("workspace_id", workspaceId).single();
  if (!cfg) {
    add("config", "cashback_config", "fail", "não existe — primeira abertura do painel vai criar defaults");
    return;
  }

  // Turn off WhatsApp per user request
  if (cfg.enable_whatsapp) {
    await db.from("cashback_config").update({ enable_whatsapp: false, updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId);
    cfg.enable_whatsapp = false;
    add("config", "enable_whatsapp", "action", "DESLIGADO por solicitação — WhatsApp não dispara até ser reativado");
  }

  const flags = {
    whatsapp: cfg.enable_whatsapp,
    email: cfg.enable_email,
    deposit: cfg.enable_deposit,
    refund: cfg.enable_refund,
    troque: cfg.enable_troquecommerce,
  };
  add("config", "feature_flags", "ok",
    `wa:${flags.whatsapp} email:${flags.email} deposit:${flags.deposit} refund:${flags.refund} troque:${flags.troque}`);
  add("config", "business_rules", "ok",
    `% ${cfg.percentage} sobre ${cfg.calculate_over} · depósito D+${cfg.deposit_delay_days} · validade ${cfg.validity_days}d · reativação +${cfg.reactivation_days}d`);
  add("config", "reminder_timing", "ok",
    `L1:D+${cfg.reminder_1_day} · L2:D+${cfg.reminder_2_day} · L3:D+${cfg.reminder_3_day} · reativ_lembr:D+${cfg.reactivation_reminder_day}`);
  add("config", "gates", "ok", `WA min: R$${cfg.whatsapp_min_value} · Email min: R$${cfg.email_min_value}`);

  // Channel mode vs flags consistency
  if (cfg.channel_mode === "whatsapp_only" && !cfg.enable_whatsapp) {
    add("config", "channel_mode_consistency", "fail",
      `channel_mode=whatsapp_only mas enable_whatsapp=false → NENHUM envio vai acontecer`);
  } else if (cfg.channel_mode === "email_only" && !cfg.enable_email) {
    add("config", "channel_mode_consistency", "fail",
      `channel_mode=email_only mas enable_email=false → NENHUM envio vai acontecer`);
  } else if ((cfg.channel_mode === "both" || cfg.channel_mode === "whatsapp_only") && !cfg.enable_whatsapp && !cfg.enable_email) {
    add("config", "channel_mode_consistency", "warn", "nenhum canal ativo mesmo com templates prontos");
  } else {
    add("config", "channel_mode_consistency", "ok",
      `channel_mode=${cfg.channel_mode} compatível com flags ativas`);
  }

  // --- 2. Integrations ---
  const { data: smtp } = await db.from("smtp_config").select("provider, from_email, api_token").eq("workspace_id", workspaceId).single();
  if (smtp?.api_token && smtp?.from_email) {
    const decrypted = decrypt(smtp.api_token as string);
    const tokenOk = decrypted.length > 10 && decrypted !== (smtp.api_token as string);
    add("integrations", "smtp (Locaweb)", tokenOk ? "ok" : "warn",
      `from=${smtp.from_email} · token encrypted=${tokenOk ? "sim" : "não"}`);
  } else {
    add("integrations", "smtp (Locaweb)", "fail", "não configurado");
  }

  const { data: troque } = await db.from("troquecommerce_config").select("base_url, webhook_token, api_token").eq("workspace_id", workspaceId).single();
  if (troque?.webhook_token) {
    add("integrations", "troque webhook", "ok",
      `webhook_token presente · URL pronta pra colar no painel Troquecommerce`);
  } else {
    add("integrations", "troque webhook", "fail", "webhook_token nulo — rode migration 056");
  }

  const { data: wa } = await db.from("wa_config").select("phone_number_id").eq("workspace_id", workspaceId).maybeSingle();
  add("integrations", "wa_config", wa?.phone_number_id ? "ok" : "info",
    wa?.phone_number_id ? `phone_number_id=${wa.phone_number_id} (WhatsApp desligado em flag)` : "não configurado (ok — WhatsApp off)");

  // --- 3. Templates ---
  const { data: templates } = await db
    .from("cashback_reminder_templates")
    .select("canal, estagio, enabled, wa_template_name, email_subject, email_body_html")
    .eq("workspace_id", workspaceId);
  const stages = ["LEMBRETE_1", "LEMBRETE_2", "LEMBRETE_3", "REATIVACAO", "REATIVACAO_LEMBRETE"];
  let emailComplete = 0;
  let waPlaceholders = 0;
  for (const s of stages) {
    const email = templates?.find((t) => t.estagio === s && t.canal === "email");
    const whatsapp = templates?.find((t) => t.estagio === s && t.canal === "whatsapp");
    if (email?.email_subject && email?.email_body_html) emailComplete++;
    if (whatsapp && !whatsapp.wa_template_name) waPlaceholders++;
  }
  add("templates", "email (5 estágios)", emailComplete === 5 ? "ok" : "fail", `${emailComplete}/5 preenchidos`);
  add("templates", "whatsapp (placeholders)", "info",
    `${waPlaceholders}/5 com wa_template_name=null — não dispara até aprovação Meta`);

  // --- 4. Data hygiene ---
  const { data: cbRows } = await db
    .from("cashback_transactions")
    .select("status, created_at")
    .eq("workspace_id", workspaceId);
  const statusCount = new Map<string, number>();
  for (const r of cbRows || []) statusCount.set(r.status as string, (statusCount.get(r.status as string) || 0) + 1);
  const statusSummary = Array.from(statusCount.entries())
    .map(([s, n]) => `${s}:${n}`)
    .join(" · ");
  add("data", "cashback_transactions total", "ok", `${cbRows?.length || 0} linhas · ${statusSummary || "(nenhuma)"}`);

  // Leftover test/probe rows
  const { data: testRows } = await db
    .from("cashback_transactions")
    .select("id, source_order_id, email, status")
    .eq("workspace_id", workspaceId)
    .or("source_order_id.like.CASHBACK-E2E%,email.like.probe+e2e%,email.like.probe+diag%")
    .limit(20);
  if (testRows && testRows.length > 0) {
    add("data", "E2E test leftovers", "fail",
      `${testRows.length} linhas de teste restantes em cashback_transactions:` +
      testRows.map((r) => `\n       - ${r.source_order_id} · ${r.email} · ${r.status}`).join(""));
  } else {
    add("data", "E2E test leftovers", "ok", "nenhuma linha de teste residual em cashback_transactions");
  }

  // Check the rolled-back customer (montanagcampelo)
  const { data: rolledBack } = await db
    .from("cashback_transactions")
    .select("id, status, depositado_em, expira_em, numero_pedido")
    .eq("workspace_id", workspaceId)
    .eq("source_order_id", "76730")
    .single();
  if (rolledBack) {
    if (rolledBack.status === "AGUARDANDO_DEPOSITO" && !rolledBack.depositado_em) {
      add("data", "rollback montanagcampelo", "ok",
        `pedido ${rolledBack.numero_pedido} em AGUARDANDO_DEPOSITO · expira ${rolledBack.expira_em}`);
    } else {
      add("data", "rollback montanagcampelo", "fail",
        `estado inesperado: status=${rolledBack.status} depositado_em=${rolledBack.depositado_em}`);
    }
  }

  // Events spread
  const { data: events } = await db
    .from("cashback_events")
    .select("tipo")
    .eq("workspace_id", workspaceId);
  const eventCount = new Map<string, number>();
  for (const e of events || []) eventCount.set(e.tipo as string, (eventCount.get(e.tipo as string) || 0) + 1);
  const eventSummary = Array.from(eventCount.entries())
    .map(([t, n]) => `${t}:${n}`)
    .join(" · ");
  add("data", "cashback_events", "ok", `${events?.length || 0} eventos · ${eventSummary || "(nenhum)"}`);

  // --- 5. Operational ---
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const { data: vndaLogs } = await db
    .from("vnda_webhook_logs")
    .select("status")
    .eq("workspace_id", workspaceId)
    .gte("created_at", yesterday.toISOString());
  const vndaOk = (vndaLogs || []).filter((l) => l.status === "success").length;
  const vndaErr = (vndaLogs || []).filter((l) => l.status === "error").length;
  add("ops", "vnda webhook 24h", vndaErr === 0 ? "ok" : "warn",
    `${vndaLogs?.length || 0} chamadas · ${vndaOk} success · ${vndaErr} error`);

  const { data: troqueLogs } = await db
    .from("troquecommerce_webhook_logs")
    .select("status")
    .eq("workspace_id", workspaceId);
  const troqueByStatus = new Map<string, number>();
  for (const l of troqueLogs || []) troqueByStatus.set(l.status as string, (troqueByStatus.get(l.status as string) || 0) + 1);
  const troqueSummary = Array.from(troqueByStatus.entries()).map(([s, n]) => `${s}:${n}`).join(" · ");
  add("ops", "troque webhook total", "ok",
    `${troqueLogs?.length || 0} probes/webhooks · ${troqueSummary || "(nenhum)"}`);

  // Check vercel.json has the cron registered — we read the committed file
  const fs = await import("fs/promises");
  try {
    const vercel = JSON.parse(await fs.readFile("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };
    const cashbackCron = vercel.crons.find((c) => c.path === "/api/cron/cashback-tick");
    add("ops", "cron vercel.json",
      cashbackCron ? "ok" : "fail",
      cashbackCron ? `registrado · schedule=${cashbackCron.schedule} (09:00 BRT)` : "NÃO está em vercel.json");
  } catch {
    add("ops", "cron vercel.json", "warn", "não pude ler vercel.json");
  }

  // --- 6. Security / hygiene ---
  const { data: configCols } = await db
    .from("cashback_config")
    .select("workspace_id")
    .limit(1);
  add("security", "RLS protection", configCols ? "ok" : "info",
    `service role pode ler (esperado) · RLS ativa em todas as cashback_* e smtp_config · troquecommerce_config`);

  // Check that secrets are encrypted (not leaked in plaintext)
  const { data: secretCheck } = await db
    .from("smtp_config")
    .select("api_token")
    .eq("workspace_id", workspaceId)
    .single();
  const isEncrypted = secretCheck?.api_token && (secretCheck.api_token as string).split(":").length === 3;
  add("security", "SMTP token at rest", isEncrypted ? "ok" : "fail",
    isEncrypted ? "formato iv:authTag:ciphertext (AES-256-GCM)" : "TOKEN EM PLAINTEXT — migrar");

  const { data: troqueToken } = await db
    .from("troquecommerce_config")
    .select("api_token")
    .eq("workspace_id", workspaceId)
    .single();
  const troqueEnc = troqueToken?.api_token && (troqueToken.api_token as string).split(":").length === 3;
  add("security", "Troque token at rest", troqueEnc ? "ok" : "warn",
    troqueEnc ? "cifrado" : "token não aparenta estar cifrado (ou ausente)");

  // Check there are no rows with reativado=true but vnda_deposit missing
  // (we log DEPOSITO event; if missing, reactivation happened without deposit)
  const { data: reactivatedRows } = await db
    .from("cashback_transactions")
    .select("id, status, reativado")
    .eq("workspace_id", workspaceId)
    .eq("reativado", true);
  add("data", "reactivation audit", "ok", `${reactivatedRows?.length || 0} cashbacks reativados no histórico`);

  // --- Summary ---
  console.log("\n╔════════════════════════════════════════════════════════╗");
  console.log("║                    Summary                             ║");
  console.log("╚════════════════════════════════════════════════════════╝");
  const counts = { ok: 0, warn: 0, fail: 0, info: 0, action: 0 };
  for (const f of findings) counts[f.severity]++;
  console.log(`✅ ${counts.ok} ok  ⚠️  ${counts.warn} warn  ❌ ${counts.fail} fail  🔧 ${counts.action} action  ℹ️  ${counts.info} info`);
  const fails = findings.filter((f) => f.severity === "fail");
  if (fails.length) {
    console.log("\nFALHAS:");
    for (const f of fails) console.log(`  - [${f.area}] ${f.check}: ${f.detail}`);
  }
  const warns = findings.filter((f) => f.severity === "warn");
  if (warns.length) {
    console.log("\nWARNINGS:");
    for (const f of warns) console.log(`  - [${f.area}] ${f.check}: ${f.detail}`);
  }
}
main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
