import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildGiftRequestVariables,
  previewWhatsAppBody,
  resolveWhatsAppVariables,
  type GiftRequestRow,
} from "./variables";

const FOLLOWUP_MIN_AGE_HOURS = 24;
const FOLLOWUP_MAX_AGE_DAYS = 14;
const FOLLOWUP_LIMIT = 100;
const FOLLOWUP_INTRO =
  "Passando pra lembrar: {{requester_name}} tinha pedido esse produto de presente. Se ainda fizer sentido, essa pode ser uma forma simples de mostrar que você lembrou.";

interface GiftRequestWithId extends GiftRequestRow {
  id: string;
  workspace_id: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  converted_at: string | null;
}

interface FollowupDispatchResult {
  ok: boolean;
  queued?: boolean;
  skipped?: boolean;
  campaignId?: string;
  messageId?: string;
  error?: string;
}

export interface GiftRequestFollowupSyncResult {
  workspaceId: string;
  scanned: number;
  queued: number;
  skipped: number;
  errors: number;
  canceled: number;
}

function followupCampaignName(
  request: Pick<GiftRequestWithId, "id" | "product_id">
): string {
  return `Gift Request Follow-up — ${request.id.slice(0, 8)} — ${request.product_id}`;
}

function followupMapping(base: Record<string, string>): Record<string, string> {
  return {
    ...base,
    "1": `text:${FOLLOWUP_INTRO}`,
  };
}

function nextSafeSendAt(): string {
  const now = new Date();
  const brtNow = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const hour = brtNow.getUTCHours();

  if (hour >= 9 && hour < 20) {
    return new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  }

  const scheduledBrt = new Date(
    Date.UTC(
      brtNow.getUTCFullYear(),
      brtNow.getUTCMonth(),
      brtNow.getUTCDate(),
      10,
      0,
      0,
      0
    )
  );

  if (scheduledBrt <= brtNow) {
    scheduledBrt.setUTCDate(scheduledBrt.getUTCDate() + 1);
  }

  return new Date(scheduledBrt.getTime() + 3 * 60 * 60 * 1000).toISOString();
}

async function dispatchGiftRequestFollowup(params: {
  admin: SupabaseClient;
  workspaceId: string;
  request: GiftRequestWithId;
  templateId: string;
  variableMapping: Record<string, string>;
}): Promise<FollowupDispatchResult> {
  const { admin, workspaceId, request, templateId, variableMapping } = params;

  const campaignName = followupCampaignName(request);
  const { data: existing } = await admin
    .from("wa_campaigns")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("name", campaignName)
    .limit(1);

  if (existing && existing.length > 0) {
    return { ok: true, skipped: true, campaignId: existing[0].id };
  }

  const { data: tpl } = await admin
    .from("wa_templates")
    .select("name, language, status, category, components")
    .eq("id", templateId)
    .single();

  if (!tpl) return { ok: false, error: "template_not_found" };
  if (tpl.status !== "APPROVED") return { ok: false, error: "template_pending" };
  if (tpl.category !== "UTILITY") return { ok: false, error: "template_not_utility" };

  const vars = buildGiftRequestVariables(request);
  const mapping = followupMapping(variableMapping || {});
  const positionalVars = resolveWhatsAppVariables(mapping, vars);
  const templateBody = (() => {
    const components = (tpl.components || []) as Array<{
      type: string;
      text?: string;
    }>;
    return components.find((c) => c.type === "BODY")?.text || "";
  })();
  const renderedBody = previewWhatsAppBody(templateBody, mapping, vars);
  const scheduledAt = nextSafeSendAt();

  const { data: campaign, error: campErr } = await admin
    .from("wa_campaigns")
    .insert({
      workspace_id: workspaceId,
      name: campaignName,
      template_id: templateId,
      variable_values: positionalVars,
      status: "scheduled",
      scheduled_at: scheduledAt,
      total_messages: 1,
      kind: "gift_request",
      segment_filter: {
        automation: "gift_request_followup",
        gift_request_id: request.id,
        followup_number: 1,
        scheduled_at: scheduledAt,
        rendered_body: renderedBody,
      },
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
      contact_name: null,
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
    queued: true,
    campaignId: campaign.id,
    messageId: msg.id,
  };
}

export async function cancelPendingGiftRequestFollowups(params: {
  admin: SupabaseClient;
  workspaceId: string;
  requestIds?: string[];
}): Promise<number> {
  const { admin, workspaceId, requestIds } = params;
  const requestIdSet =
    requestIds && requestIds.length > 0
      ? new Set(requestIds.map((id) => String(id)))
      : null;
  if (!requestIdSet) return 0;

  const { data: campaigns, error } = await admin
    .from("wa_campaigns")
    .select("id, segment_filter")
    .eq("workspace_id", workspaceId)
    .eq("kind", "gift_request")
    .in("status", ["queued", "scheduled", "sending"]);

  if (error || !campaigns || campaigns.length === 0) return 0;

  const followupCampaignIds = campaigns
    .filter((campaign) => {
      const filter = campaign.segment_filter as Record<string, unknown> | null;
      if (filter?.automation !== "gift_request_followup") return false;
      return requestIdSet.has(String(filter.gift_request_id || ""));
    })
    .map((campaign) => campaign.id as string);

  if (followupCampaignIds.length === 0) return 0;

  await admin
    .from("wa_campaigns")
    .update({ status: "canceled" })
    .in("id", followupCampaignIds);
  await admin
    .from("wa_messages")
    .update({ status: "canceled" })
    .in("campaign_id", followupCampaignIds)
    .eq("status", "queued");

  return followupCampaignIds.length;
}

export async function enqueueGiftRequestFollowups(params: {
  admin: SupabaseClient;
  workspaceId: string;
}): Promise<GiftRequestFollowupSyncResult> {
  const { admin, workspaceId } = params;

  const { data: config } = await admin
    .from("gift_request_configs")
    .select("enabled, wa_template_id, wa_variable_mapping")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!config?.enabled || !config.wa_template_id) {
    return {
      workspaceId,
      scanned: 0,
      queued: 0,
      skipped: 0,
      errors: 0,
      canceled: 0,
    };
  }

  const olderThan = new Date(
    Date.now() - FOLLOWUP_MIN_AGE_HOURS * 3600_000
  ).toISOString();
  const newerThan = new Date(
    Date.now() - FOLLOWUP_MAX_AGE_DAYS * 24 * 3600_000
  ).toISOString();

  const { data: convertedRequests, error: convertedError } = await admin
    .from("gift_requests")
    .select("id")
    .eq("workspace_id", workspaceId)
    .not("converted_at", "is", null)
    .gte("created_at", newerThan);

  if (convertedError) throw new Error(convertedError.message);

  const convertedRequestIds = (
    (convertedRequests || []) as Array<{ id: string }>
  )
    .map((request) => request.id)
    .filter(Boolean);
  const canceled =
    convertedRequestIds.length > 0
      ? await cancelPendingGiftRequestFollowups({
          admin,
          workspaceId,
          requestIds: convertedRequestIds,
        })
      : 0;

  const { data: requests, error } = await admin
    .from("gift_requests")
    .select(
      "id, workspace_id, requester_name, requester_phone, recipient_phone, product_id, product_name, product_url, product_price, personal_message, status, created_at, sent_at, converted_at"
    )
    .eq("workspace_id", workspaceId)
    .is("converted_at", null)
    .in("status", ["sent", "delivered", "read"])
    .not("recipient_phone", "is", null)
    .not("sent_at", "is", null)
    .lte("sent_at", olderThan)
    .gte("created_at", newerThan)
    .order("created_at", { ascending: true })
    .limit(FOLLOWUP_LIMIT);

  if (error) throw new Error(error.message);

  let queued = 0;
  let skipped = 0;
  let errors = 0;

  for (const request of (requests || []) as GiftRequestWithId[]) {
    const result = await dispatchGiftRequestFollowup({
      admin,
      workspaceId,
      request,
      templateId: config.wa_template_id,
      variableMapping: config.wa_variable_mapping || {},
    });

    if (result.queued) queued++;
    else if (result.skipped) skipped++;
    else if (!result.ok) errors++;
  }

  return {
    workspaceId,
    scanned: requests?.length || 0,
    queued,
    skipped,
    errors,
    canceled,
  };
}
