import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTemplateOnMeta,
  getWaConfig,
  recheckTemplateOnMeta,
} from "@/lib/whatsapp-api";
import {
  DEFAULT_VARIABLE_MAPPING,
  UTILITY_TEMPLATE_BODY,
  UTILITY_TEMPLATE_EXAMPLE_BODY_TEXT,
} from "./recommended";

type GiftTemplateRow = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components: unknown;
};

export type GiftTemplateResolution = {
  ok: boolean;
  templateId?: string;
  template?: GiftTemplateRow;
  switched?: boolean;
  created?: boolean;
  pending?: boolean;
  error?: string;
};

const TEMPLATE_SELECT = "id, name, language, status, category, components";

function bodyText(template: Pick<GiftTemplateRow, "components">): string {
  const components = (template.components || []) as Array<{
    type?: string;
    text?: string;
  }>;
  return components.find((component) => component.type === "BODY")?.text || "";
}

function isCompatibleUtilityTemplate(template: GiftTemplateRow | null): boolean {
  return (
    !!template &&
    template.language === "pt_BR" &&
    template.status === "APPROVED" &&
    template.category === "UTILITY" &&
    bodyText(template) === UTILITY_TEMPLATE_BODY
  );
}

function isPendingCompatibleTemplate(template: GiftTemplateRow | null): boolean {
  return (
    !!template &&
    template.language === "pt_BR" &&
    template.status === "PENDING" &&
    template.category === "UTILITY" &&
    bodyText(template) === UTILITY_TEMPLATE_BODY
  );
}

async function fetchTemplate(
  admin: SupabaseClient,
  workspaceId: string,
  templateId: string
): Promise<GiftTemplateRow | null> {
  const { data, error } = await admin
    .from("wa_templates")
    .select(TEMPLATE_SELECT)
    .eq("workspace_id", workspaceId)
    .eq("id", templateId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as GiftTemplateRow | null) || null;
}

async function refreshTemplate(
  admin: SupabaseClient,
  workspaceId: string,
  template: GiftTemplateRow
): Promise<GiftTemplateRow> {
  await recheckTemplateOnMeta(workspaceId, template.id).catch(() => null);
  return (await fetchTemplate(admin, workspaceId, template.id)) || template;
}

async function linkTemplateToConfig(params: {
  admin: SupabaseClient;
  workspaceId: string;
  templateId: string;
}) {
  const { admin, workspaceId, templateId } = params;
  const now = new Date().toISOString();
  const { data: config } = await admin
    .from("gift_request_configs")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (config) {
    await admin
      .from("gift_request_configs")
      .update({ wa_template_id: templateId, updated_at: now })
      .eq("workspace_id", workspaceId);
    return;
  }

  await admin.from("gift_request_configs").upsert(
    {
      workspace_id: workspaceId,
      wa_template_id: templateId,
      wa_variable_mapping: DEFAULT_VARIABLE_MAPPING,
      updated_at: now,
    },
    { onConflict: "workspace_id" }
  );
}

async function findApprovedFallback(params: {
  admin: SupabaseClient;
  workspaceId: string;
}): Promise<GiftTemplateRow | null> {
  const { admin, workspaceId } = params;
  const { data, error } = await admin
    .from("wa_templates")
    .select(TEMPLATE_SELECT)
    .eq("workspace_id", workspaceId)
    .eq("language", "pt_BR")
    .eq("category", "UTILITY")
    .eq("status", "APPROVED")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) throw new Error(error.message);

  for (const candidate of (data || []) as GiftTemplateRow[]) {
    if (bodyText(candidate) !== UTILITY_TEMPLATE_BODY) continue;
    const refreshed = await refreshTemplate(admin, workspaceId, candidate);
    if (isCompatibleUtilityTemplate(refreshed)) return refreshed;
  }

  return null;
}

async function findPendingFallback(params: {
  admin: SupabaseClient;
  workspaceId: string;
}): Promise<GiftTemplateRow | null> {
  const { admin, workspaceId } = params;
  const { data, error } = await admin
    .from("wa_templates")
    .select(TEMPLATE_SELECT)
    .eq("workspace_id", workspaceId)
    .eq("language", "pt_BR")
    .eq("category", "UTILITY")
    .eq("status", "PENDING")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) throw new Error(error.message);

  for (const candidate of (data || []) as GiftTemplateRow[]) {
    if (bodyText(candidate) !== UTILITY_TEMPLATE_BODY) continue;
    const refreshed = await refreshTemplate(admin, workspaceId, candidate);
    if (isCompatibleUtilityTemplate(refreshed)) return refreshed;
    if (isPendingCompatibleTemplate(refreshed)) return refreshed;
  }

  return null;
}

async function createUtilityTemplate(params: {
  admin: SupabaseClient;
  workspaceId: string;
}): Promise<GiftTemplateRow> {
  const { admin, workspaceId } = params;
  const config = await getWaConfig(workspaceId);
  if (!config) throw new Error("no_wa_config");

  const name = `bkng_share_message_v${Date.now()}`;
  const language = "pt_BR";
  const category = "UTILITY";
  const components = [
    {
      type: "BODY",
      text: UTILITY_TEMPLATE_BODY,
      example: { body_text: UTILITY_TEMPLATE_EXAMPLE_BODY_TEXT },
    },
  ];

  const metaResult = await createTemplateOnMeta(config, {
    name,
    language,
    category,
    components,
  });

  const { data: template, error } = await admin
    .from("wa_templates")
    .insert({
      workspace_id: workspaceId,
      meta_id: metaResult.id,
      name,
      language,
      category: metaResult.category || category,
      status: metaResult.status || "PENDING",
      components,
      synced_at: new Date().toISOString(),
    })
    .select(TEMPLATE_SELECT)
    .single();

  if (error || !template) {
    throw new Error(error?.message || "template_insert_failed");
  }

  return template as GiftTemplateRow;
}

export async function resolveGiftRequestUtilityTemplate(params: {
  admin: SupabaseClient;
  workspaceId: string;
  configuredTemplateId: string | null | undefined;
  updateConfig?: boolean;
}): Promise<GiftTemplateResolution> {
  const { admin, workspaceId, configuredTemplateId, updateConfig = true } = params;

  try {
    if (configuredTemplateId) {
      const current = await fetchTemplate(admin, workspaceId, configuredTemplateId);
      if (current) {
        const refreshed = await refreshTemplate(admin, workspaceId, current);
        if (isCompatibleUtilityTemplate(refreshed)) {
          return { ok: true, templateId: refreshed.id, template: refreshed };
        }
      }
    }

    const fallback = await findApprovedFallback({ admin, workspaceId });
    if (fallback) {
      if (updateConfig && fallback.id !== configuredTemplateId) {
        await linkTemplateToConfig({ admin, workspaceId, templateId: fallback.id });
      }
      return {
        ok: true,
        templateId: fallback.id,
        template: fallback,
        switched: fallback.id !== configuredTemplateId,
      };
    }

    const pending = await findPendingFallback({ admin, workspaceId });
    if (pending) {
      if (updateConfig && pending.id !== configuredTemplateId) {
        await linkTemplateToConfig({ admin, workspaceId, templateId: pending.id });
      }
      return {
        ok: false,
        templateId: pending.id,
        template: pending,
        switched: pending.id !== configuredTemplateId,
        pending: true,
        error: "template_pending",
      };
    }

    const created = await createUtilityTemplate({ admin, workspaceId });
    if (updateConfig) {
      await linkTemplateToConfig({ admin, workspaceId, templateId: created.id });
    }

    if (isCompatibleUtilityTemplate(created)) {
      return {
        ok: true,
        templateId: created.id,
        template: created,
        switched: created.id !== configuredTemplateId,
        created: true,
      };
    }

    return {
      ok: false,
      templateId: created.id,
      template: created,
      switched: created.id !== configuredTemplateId,
      created: true,
      pending: created.status === "PENDING",
      error: created.status === "PENDING" ? "template_pending" : "template_not_utility",
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "template_resolution_failed",
    };
  }
}
