import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildGiftRequestVariables,
  previewWhatsAppBody,
  resolveWhatsAppVariables,
  type GiftRequestRow,
} from "./variables";
import { DEFAULT_VARIABLE_MAPPING } from "./recommended";
import { resolveGiftRequestUtilityTemplate } from "./template-resolver";

export interface GiftDispatchResult {
  ok: boolean;
  campaignId?: string;
  messageId?: string;
  error?: string;
  renderedBody?: string;
  variables?: Record<string, string>;
}

// Enfileira o WhatsApp do "Pedir de presente" no mesmo canal (wa_campaigns +
// wa_messages, kind='gift_request'). O worker dedicado pega
// e entrega via Meta Cloud API. Status volta via webhook → wa_messages.
//
// gift_requests.wa_message_id linka de volta pra propagar status na UI
// (delivered_at/read_at vêm de wa_messages no JOIN).
export async function dispatchGiftRequest(params: {
  admin: SupabaseClient;
  workspaceId: string;
  request: GiftRequestRow & { id: string };
  templateId: string | null | undefined;
  variableMapping: Record<string, string>;
  storeName?: string;
}): Promise<GiftDispatchResult> {
  const { admin, workspaceId, request, templateId, variableMapping, storeName } =
    params;

  if (!request.recipient_phone) {
    return { ok: false, error: "no_recipient_phone" };
  }

  const templateResolution = await resolveGiftRequestUtilityTemplate({
    admin,
    workspaceId,
    configuredTemplateId: templateId,
    updateConfig: true,
  });
  if (!templateResolution.ok || !templateResolution.templateId || !templateResolution.template) {
    return { ok: false, error: templateResolution.error || "template_not_ready" };
  }

  const vars = buildGiftRequestVariables(request, { storeName });
  const mapping =
    Object.keys(variableMapping || {}).length > 0
      ? variableMapping
      : DEFAULT_VARIABLE_MAPPING;
  const positionalVars = resolveWhatsAppVariables(mapping, vars);

  const templateBody = (() => {
    const components = (templateResolution.template?.components || []) as Array<{
      type: string;
      text?: string;
    }>;
    return components.find((c) => c.type === "BODY")?.text || "";
  })();
  const renderedBody = previewWhatsAppBody(
    templateBody,
    mapping,
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
      template_id: templateResolution.templateId,
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
