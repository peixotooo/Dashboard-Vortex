import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWaConfig, sendTemplateMessage } from "@/lib/whatsapp-api";
import { getSmtpConfig, sendEmail } from "./locaweb-smtp";
import {
  appendUnsubscribeFooter,
  buildListUnsubscribeHeaders,
  buildUnsubscribeUrl,
  isEmailSuppressed,
} from "@/lib/email-unsubscribe";
import {
  buildVarMap,
  formatBRL,
  formatDateLong,
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

export const IDEMPOTENCY_COLUMN: Record<CashbackStage, keyof CashbackTransactionRow> = {
  LEMBRETE_1: "lembrete1_enviado_em",
  LEMBRETE_2: "lembrete2_enviado_em",
  LEMBRETE_3: "lembrete3_enviado_em",
  REATIVACAO: "reativacao_enviado_em",
  REATIVACAO_LEMBRETE: "reativacao_lembrete2",
};

const REMINDER_VARIANT = "benefit_reward_urgency_v1";

const RECOMMENDED_EMAIL_TEMPLATES: Partial<Record<CashbackStage, { subject: string; body: string }>> = {
  LEMBRETE_1: {
    subject: "{{nome}}, seu cashback de {{valor}} já está disponível",
    body:
      "<p>Oi {{nome}}, tudo bem?</p><p>Seu cashback de <strong>{{valor}}</strong> do pedido {{pedido}} já está disponível na sua conta.</p><p>Para usar, entre na loja com o e-mail {{email}} e escolha o crédito no checkout antes de finalizar a compra.</p><p>Ele fica disponível até <strong>{{expira_em_long}}</strong>.</p>",
  },
  LEMBRETE_2: {
    subject: "{{nome}}, seu cashback de {{valor}} ainda está disponível",
    body:
      "<p>Oi {{nome}}, tudo bem?</p><p>Você ainda tem <strong>{{valor}}</strong> de cashback parado na sua conta.</p><p>Na próxima compra, acesse a loja com o e-mail {{email}} e aplique o crédito no checkout. É simples e o desconto aparece antes de fechar o pedido.</p><p>Validade: <strong>{{expira_em_long}}</strong>.</p>",
  },
  LEMBRETE_3: {
    subject: "Últimos dias para usar seu cashback de {{valor}}, {{nome}}",
    body:
      "<p>Oi {{nome}}, tudo bem?</p><p>Passando para lembrar que seu cashback de <strong>{{valor}}</strong> vence em poucos dias.</p><p>Se fizer sentido comprar agora, entre com o e-mail {{email}} e aplique o crédito no checkout antes de finalizar.</p><p>Válido até <strong>{{expira_em_long}}</strong>.</p>",
  },
  REATIVACAO: {
    subject: "{{nome}}, reativamos seu cashback de {{valor}}",
    body:
      "<p>Oi {{nome}}, tudo bem?</p><p>Reativamos <strong>{{valor}}</strong> de cashback na sua conta.</p><p>Para usar, entre na loja com o e-mail {{email}} e aplique o crédito no checkout antes de finalizar.</p><p>Validade: <strong>{{expira_em_long}}</strong>.</p>",
  },
  REATIVACAO_LEMBRETE: {
    subject: "Seu cashback reativado vence em breve, {{nome}}",
    body:
      "<p>Oi {{nome}}, tudo bem?</p><p>Seu cashback reativado de <strong>{{valor}}</strong> ainda está disponível, mas vence em breve.</p><p>Use o e-mail {{email}} no checkout para aplicar o crédito antes de finalizar a compra.</p><p>Validade: <strong>{{expira_em_long}}</strong>.</p>",
  },
};

function buildVars(cashback: CashbackTransactionRow): TemplateVars {
  return {
    nome: cashback.nome_cliente?.split(" ")[0] || "cliente",
    valor: Number(cashback.valor_cashback),
    expiraEm: new Date(cashback.expira_em),
    pedido: cashback.numero_pedido || cashback.source_order_id,
    email: cashback.email,
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
  const row = (data as ReminderTemplateRow | null) ?? null;

  const recommended = RECOMMENDED_EMAIL_TEMPLATES[estagio];
  if (!row && canal === "email" && recommended) {
    const created: ReminderTemplateRow = {
      canal,
      estagio,
      enabled: true,
      wa_template_name: null,
      wa_template_language: "pt_BR",
      email_subject: recommended.subject,
      email_body_html: recommended.body,
    };
    await admin
      .from("cashback_reminder_templates")
      .upsert({
        workspace_id: workspaceId,
        canal,
        estagio,
        enabled: true,
        wa_template_name: null,
        wa_template_language: "pt_BR",
        email_subject: recommended.subject,
        email_body_html: recommended.body,
        updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id, canal, estagio" });
    return created;
  }

  const currentText = `${row?.email_subject || ""}\n${row?.email_body_html || ""}`;
  const hasOldTone = /vira fuma|hoje ou nunca|desperd[ií]cio|amanh[aã] some/i.test(currentText);
  if (row && canal === "email" && recommended && (!row.email_subject || !row.email_body_html || hasOldTone)) {
    const updated = {
      ...row,
      email_subject: recommended.subject,
      email_body_html: recommended.body,
      enabled: true,
    };
    await admin
      .from("cashback_reminder_templates")
      .upsert({
        workspace_id: workspaceId,
        canal,
        estagio,
        enabled: true,
        wa_template_name: row.wa_template_name,
        wa_template_language: row.wa_template_language || "pt_BR",
        email_subject: recommended.subject,
        email_body_html: recommended.body,
        updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id, canal, estagio" });
    return updated;
  }

  return row;
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

  // Bulking-approved cashback templates (cashback_01/02/03) all share the
  // same body variable order: {{1}} nome, {{2}} valor, {{3}} email, {{4}} expira_em (dd/MM/yyyy)
  const result = await sendTemplateMessage(
    wa,
    phone,
    template.wa_template_name,
    template.wa_template_language || "pt_BR",
    {
      "1": vars.nome,
      "2": formatBRL(vars.valor),
      "3": vars.email,
      "4": formatDateLong(vars.expiraEm),
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
  admin: SupabaseClient,
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
  if (await isEmailSuppressed(admin, workspaceId, email)) {
    return { channel: "email", sent: false, skipped: "email_suppressed" };
  }

  const map = buildVarMap(vars);
  const unsubscribeUrl = buildUnsubscribeUrl({
    workspaceId,
    email,
    source: "cashback",
  });
  const result = await sendEmail(smtp, {
    to: email,
    subject: renderTemplate(template.email_subject, map),
    bodyHtml: appendUnsubscribeFooter(
      renderTemplate(template.email_body_html, map),
      unsubscribeUrl
    ),
    headers: buildListUnsubscribeHeaders(unsubscribeUrl),
  });

  return {
    channel: "email",
    sent: result.ok,
    error: result.error,
    messageId: result.messageId,
  };
}

function reminderPayload(
  cashback: CashbackTransactionRow,
  stage: CashbackStage,
  cfg: CashbackConfigRow,
  results: ReminderSendResult[],
  options?: { variant?: string; holdout?: boolean }
): Record<string, unknown> {
  const cleanResults = results.map((r) => ({
    channel: r.channel,
    sent: r.sent,
    skipped: r.skipped ?? null,
    error: r.error ?? null,
    message_id: r.messageId ?? null,
  }));
  return {
    stage,
    variant: options?.variant ?? REMINDER_VARIANT,
    holdout: options?.holdout ?? false,
    sent: cleanResults.some((r) => r.sent),
    sent_channels: cleanResults.filter((r) => r.sent).map((r) => r.channel),
    skipped_channels: cleanResults.filter((r) => !r.sent).map((r) => ({
      channel: r.channel,
      reason: r.skipped ?? r.error ?? "not_sent",
    })),
    results: cleanResults,
    credit_used: null,
    source_order_total: null,
    valor_cashback: Number(cashback.valor_cashback),
    gates: {
      whatsapp_min_value: Number(cfg.whatsapp_min_value),
      email_min_value: Number(cfg.email_min_value),
    },
  };
}

async function logReminderAttempt(
  admin: SupabaseClient,
  cashback: CashbackTransactionRow,
  stage: CashbackStage,
  cfg: CashbackConfigRow,
  results: ReminderSendResult[],
  options?: { variant?: string; holdout?: boolean; logAttempt?: boolean }
) {
  if (options?.logAttempt === false) return;
  await logEvent(admin, cashback.workspace_id, cashback.id, stage, reminderPayload(cashback, stage, cfg, results, options));
}

/**
 * Sends reminder for (cashback × stage) across the channels enabled by config.
 * Idempotent via the per-stage timestamp column on cashback_transactions.
 */
export async function sendReminderForStage(
  cashback: CashbackTransactionRow,
  stage: CashbackStage,
  cfg: CashbackConfigRow,
  admin?: SupabaseClient,
  options?: { variant?: string; holdout?: boolean; logAttempt?: boolean }
): Promise<ReminderSendResult[]> {
  const client = admin ?? createAdminClient();
  const results: ReminderSendResult[] = [];

  const col = IDEMPOTENCY_COLUMN[stage];
  if (cashback[col]) {
    const already: ReminderSendResult[] = [
      { channel: "whatsapp" as const, sent: false, skipped: "already_sent" },
      { channel: "email" as const, sent: false, skipped: "already_sent" },
    ];
    await logReminderAttempt(client, cashback, stage, cfg, already, options);
    return already;
  }

  // Hard stop: cashback already used, expired, or cancelled — no more comms.
  // The cron jobs filter by status upstream, this is a defensive guard for
  // the manual force-reminder route and any future caller.
  if (cashback.status === "USADO" || cashback.status === "EXPIRADO" || cashback.status === "CANCELADO") {
    const blocked: ReminderSendResult[] = [
      { channel: "whatsapp", sent: false, skipped: `cashback_${cashback.status.toLowerCase()}` },
      { channel: "email", sent: false, skipped: `cashback_${cashback.status.toLowerCase()}` },
    ];
    await logReminderAttempt(client, cashback, stage, cfg, blocked, options);
    return blocked;
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
    const res = await sendEmailChannel(client, cashback.workspace_id, cashback.email, emTemplate, vars);
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
  }

  await logReminderAttempt(client, cashback, stage, cfg, results, options);

  return results;
}
