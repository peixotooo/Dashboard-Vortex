import type { SupabaseClient } from "@supabase/supabase-js";
import { getSmtpConfig, sendEmail } from "@/lib/cashback/locaweb-smtp";
import type { CartRecoveryStep } from "./types";
import {
  buildRecoveryVariables,
  interpolate,
  resolveWhatsAppVariables,
  type CartRow,
} from "./variables";

export interface DispatchResult {
  ok: boolean;
  externalId?: string;
  error?: string;
}

// ============================================================
// WhatsApp — enfileira no canal existente (wa_campaigns + wa_messages).
// O cron /api/cron/whatsapp-sender pega e entrega via Meta Cloud API.
// ============================================================
// Criamos 1 wa_campaign por (cart, step) com 1 wa_message. Mantém o
// histórico atômico, deduplica via cart_recovery_messages (UNIQUE), e
// reusa toda a infra de exclusion list, rate limit, retries e stats.

export async function dispatchWhatsApp(params: {
  admin: SupabaseClient;
  workspaceId: string;
  cart: CartRow & { id: string };
  step: CartRecoveryStep;
  storeName?: string;
}): Promise<DispatchResult> {
  const { admin, workspaceId, cart, step, storeName } = params;

  if (!cart.customer_phone) {
    return { ok: false, error: "no_phone" };
  }
  if (!step.whatsapp_template_id) {
    return { ok: false, error: "no_template" };
  }

  const vars = buildRecoveryVariables(cart, { storeName });
  const positionalVars = resolveWhatsAppVariables(
    step.whatsapp_variable_mapping || {},
    vars
  );

  // Cria campanha "fantasma" com 1 mensagem.
  const campaignName = `Cart Recovery — cart ${cart.id.slice(0, 8)} — step ${step.step_order}`;
  const { data: campaign, error: campErr } = await admin
    .from("wa_campaigns")
    .insert({
      workspace_id: workspaceId,
      name: campaignName,
      template_id: step.whatsapp_template_id,
      variable_values: positionalVars,
      status: "queued",
      total_messages: 1,
    })
    .select("id")
    .single();

  if (campErr || !campaign) {
    return { ok: false, error: campErr?.message || "campaign_insert_failed" };
  }

  const { data: msg, error: msgErr } = await admin
    .from("wa_messages")
    .insert({
      workspace_id: workspaceId,
      campaign_id: campaign.id,
      phone: cart.customer_phone,
      contact_name: cart.customer_name,
      variable_values: positionalVars,
      status: "queued",
    })
    .select("id")
    .single();

  if (msgErr || !msg) {
    // Rollback da campanha pra não deixar lixo.
    await admin.from("wa_campaigns").delete().eq("id", campaign.id);
    return { ok: false, error: msgErr?.message || "message_insert_failed" };
  }

  return { ok: true, externalId: msg.id };
}

// ============================================================
// Email — disparo síncrono via Locaweb SMTP (transacional).
// Reusa src/lib/cashback/locaweb-smtp.ts.
// ============================================================

export async function dispatchEmail(params: {
  admin: SupabaseClient;
  workspaceId: string;
  cart: CartRow;
  step: CartRecoveryStep;
  storeName?: string;
}): Promise<DispatchResult> {
  const { admin, workspaceId, cart, step, storeName } = params;

  if (!step.email_subject || !step.email_body_html) {
    return { ok: false, error: "missing_email_content" };
  }

  const smtp = await getSmtpConfig(workspaceId, admin);
  if (!smtp) {
    return { ok: false, error: "no_smtp_config" };
  }

  const vars = buildRecoveryVariables(cart, { storeName });
  const subject = interpolate(step.email_subject, vars);
  const bodyHtml = interpolate(step.email_body_html, vars);

  const result = await sendEmail(smtp, {
    to: cart.customer_email,
    subject,
    bodyHtml,
  });

  if (!result.ok) {
    return { ok: false, error: result.error || "send_failed" };
  }
  return { ok: true, externalId: result.messageId };
}
