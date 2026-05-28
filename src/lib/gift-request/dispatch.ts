import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildGiftRequestVariables,
  previewWhatsAppBody,
  resolveWhatsAppVariables,
  type GiftRequestRow,
} from "./variables";

export interface GiftDispatchResult {
  ok: boolean;
  campaignId?: string;
  messageId?: string;
  error?: string;
  renderedBody?: string;
  variables?: Record<string, string>;
}

// Enfileira o WhatsApp do "Pedir de presente" no mesmo canal (wa_campaigns +
// wa_messages, kind='gift_request'). O cron /api/cron/whatsapp-sender pega
// e entrega via Meta Cloud API. Status volta via webhook → wa_messages.
//
// gift_requests.wa_message_id linka de volta pra propagar status na UI
// (delivered_at/read_at vêm de wa_messages no JOIN).
export async function dispatchGiftRequest(params: {
  admin: SupabaseClient;
  workspaceId: string;
  request: GiftRequestRow & { id: string };
  templateId: string;
  variableMapping: Record<string, string>;
  storeName?: string;
}): Promise<GiftDispatchResult> {
  const { admin, workspaceId, request, templateId, variableMapping, storeName } =
    params;

  if (!request.recipient_phone) {
    return { ok: false, error: "no_recipient_phone" };
  }

  // Confere se o template está APROVADO pela Meta antes de enfileirar.
  const { data: tpl } = await admin
    .from("wa_templates")
    .select("name, language, status, components")
    .eq("id", templateId)
    .single();

  if (!tpl) {
    return { ok: false, error: "template_not_found" };
  }
  if (tpl.status !== "APPROVED") {
    return { ok: false, error: "template_pending" };
  }

  const vars = buildGiftRequestVariables(request, { storeName });
  const positionalVars = resolveWhatsAppVariables(variableMapping || {}, vars);

  const templateBody = (() => {
    const components = (tpl.components || []) as Array<{
      type: string;
      text?: string;
    }>;
    return components.find((c) => c.type === "BODY")?.text || "";
  })();
  const renderedBody = previewWhatsAppBody(
    templateBody,
    variableMapping || {},
    vars
  );

  // Campanha "fantasma" 1:1. kind='gift_request' esconde da listagem de
  // /crm/whatsapp e permite filtrar relatórios depois.
  const campaignName = `Gift Request — ${request.id.slice(0, 8)} — ${request.product_id}`;
  const { data: campaign, error: campErr } = await admin
    .from("wa_campaigns")
    .insert({
      workspace_id: workspaceId,
      name: campaignName,
      template_id: templateId,
      variable_values: positionalVars,
      status: "queued",
      total_messages: 1,
      kind: "gift_request",
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
      phone: request.recipient_phone,
      contact_name: null, // não temos o nome do presenteado
      variable_values: positionalVars,
      status: "queued",
    })
    .select("id")
    .single();

  if (msgErr || !msg) {
    await admin.from("wa_campaigns").delete().eq("id", campaign.id);
    return { ok: false, error: msgErr?.message || "message_insert_failed" };
  }

  return {
    ok: true,
    campaignId: campaign.id,
    messageId: msg.id,
    renderedBody,
    variables: positionalVars,
  };
}
