import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWaConfig, sendTemplateMessage } from "@/lib/whatsapp-api";
import { getSmtpConfig, sendEmail } from "./locaweb-smtp";
import {
  buildVarMap,
  formatBRL,
  formatDateShort,
  renderTemplate,
  type TemplateVars,
} from "./templating";
import {
  shouldSendChannel,
  logEvent,
  type CashbackConfigRow,
  type CashbackStage,
  type CashbackTransactionRow,
} from "./api";

export interface ReminderTemplateRow {
  canal: "whatsapp" | "email";
  estagio: CashbackStage;
  enabled: boolean;
  wa_template_name: string | null;
  wa_template_language: string | null;
  email_subject: string | null;
  email_body_html: string | null;
}

export interface ReminderSendResult {
  channel: "whatsapp" | "email";
  sent: boolean;
  skipped?: string;
  error?: string;
  messageId?: string;
}

const IDEMPOTENCY_COLUMN: Record<CashbackStage, keyof CashbackTransactionRow> = {
  LEMBRETE_1: "lembrete1_enviado_em",
  LEMBRETE_2: "lembrete2_enviado_em",
  LEMBRETE_3: "lembrete3_enviado_em",
  REATIVACAO: "reativacao_enviado_em",
  REATIVACAO_LEMBRETE: "reativacao_lembrete2",
};

function buildVars(cashback: CashbackTransactionRow): TemplateVars {
  return {
    nome: cashback.nome_cliente?.split(" ")[0] || "cliente",
    valor: Number(cashback.valor_cashback),
    expiraEm: new Date(cashback.expira_em),
    pedido: cashback.numero_pedido || cashback.source_order_id,
  };
}

async function loadTemplate(
  admin: SupabaseClient,
  workspaceId: string,
  canal: "whatsapp" | "email",
  estagio: CashbackStage
): Promise<ReminderTemplateRow | null> {
  const { data } = await admin
    .from("cashback_reminder_templates")
    .select("canal, estagio, enabled, wa_template_name, wa_template_language, email_subject, email_body_html")
    .eq("workspace_id", workspaceId)
    .eq("canal", canal)
    .eq("estagio", estagio)
    .maybeSingle();
  return (data as ReminderTemplateRow | null) ?? null;
}

async function sendWhatsApp(
  workspaceId: string,
  phone: string,
  template: ReminderTemplateRow,
  vars: TemplateVars
): Promise<ReminderSendResult> {
  if (!template.wa_template_name) {
    return { channel: "whatsapp", sent: false, error: "no_template_name" };
  }
  const wa = await getWaConfig(workspaceId);
  if (!wa) return { channel: "whatsapp", sent: false, error: "no_wa_config" };

  const result = await sendTemplateMessage(
    wa,
    phone,
    template.wa_template_name,
    template.wa_template_language || "pt_BR",
    {
      "1": vars.nome,
      "2": formatBRL(vars.valor),
      "3": formatDateShort(vars.expiraEm),
    }
  );

  return {
    channel: "whatsapp",
    sent: result.error == null,
    error: result.error ?? undefined,
    messageId: result.messageId ?? undefined,
  };
}

async function sendEmailChannel(
  workspaceId: string,
  email: string,
  template: ReminderTemplateRow,
  vars: TemplateVars
): Promise<ReminderSendResult> {
  if (!template.email_subject || !template.email_body_html) {
    return { channel: "email", sent: false, error: "no_email_template" };
  }
  const smtp = await getSmtpConfig(workspaceId);
  if (!smtp) return { channel: "email", sent: false, error: "no_smtp_config" };

  const map = buildVarMap(vars);
  const result = await sendEmail(smtp, {
    to: email,
    subject: renderTemplate(template.email_subject, map),
    bodyHtml: renderTemplate(template.email_body_html, map),
  });

  return {
    channel: "email",
    sent: result.ok,
    error: result.error,
    messageId: result.messageId,
  };
}

/**
 * Sends reminder for (cashback × stage) across the channels enabled by config.
 * Idempotent via the per-stage timestamp column on cashback_transactions.
 */
export async function sendReminderForStage(
  cashback: CashbackTransactionRow,
  stage: CashbackStage,
  cfg: CashbackConfigRow,
  admin?: SupabaseClient
): Promise<ReminderSendResult[]> {
  const client = admin ?? createAdminClient();
  const results: ReminderSendResult[] = [];

  const col = IDEMPOTENCY_COLUMN[stage];
  if (cashback[col]) {
    return [{ channel: "whatsapp", sent: false, skipped: "already_sent" }];
  }

  const vars = buildVars(cashback);

  // WhatsApp
  const waTemplate = await loadTemplate(client, cashback.workspace_id, "whatsapp", stage);
  const waEnabled = shouldSendChannel(cfg, "whatsapp", waTemplate?.enabled ?? true);
  const meetsWaGate = Number(cashback.valor_cashback) >= Number(cfg.whatsapp_min_value);
  if (waEnabled && meetsWaGate && waTemplate && cashback.telefone) {
    const res = await sendWhatsApp(cashback.workspace_id, cashback.telefone, waTemplate, vars);
    results.push(res);
  } else if (waEnabled && !meetsWaGate) {
    results.push({ channel: "whatsapp", sent: false, skipped: "below_gate" });
  } else if (waEnabled && !waTemplate) {
    results.push({ channel: "whatsapp", sent: false, skipped: "no_template" });
  } else if (waEnabled && !cashback.telefone) {
    results.push({ channel: "whatsapp", sent: false, skipped: "no_phone" });
  } else {
    results.push({ channel: "whatsapp", sent: false, skipped: "channel_disabled" });
  }

  // Email
  const emTemplate = await loadTemplate(client, cashback.workspace_id, "email", stage);
  const emEnabled = shouldSendChannel(cfg, "email", emTemplate?.enabled ?? true);
  const meetsEmGate = Number(cashback.valor_cashback) >= Number(cfg.email_min_value);
  if (emEnabled && meetsEmGate && emTemplate) {
    const res = await sendEmailChannel(cashback.workspace_id, cashback.email, emTemplate, vars);
    results.push(res);
  } else if (emEnabled && !meetsEmGate) {
    results.push({ channel: "email", sent: false, skipped: "below_gate" });
  } else if (emEnabled && !emTemplate) {
    results.push({ channel: "email", sent: false, skipped: "no_template" });
  } else {
    results.push({ channel: "email", sent: false, skipped: "channel_disabled" });
  }

  // If at least one channel sent successfully, mark idempotency timestamp.
  const anySent = results.some((r) => r.sent);
  if (anySent) {
    const patch: Record<string, string> = {
      [col as string]: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await client.from("cashback_transactions").update(patch).eq("id", cashback.id);

    await logEvent(client, cashback.workspace_id, cashback.id, stage, {
      results: results.map((r) => ({ channel: r.channel, sent: r.sent, error: r.error, skipped: r.skipped })),
    });
  }

  return results;
}
