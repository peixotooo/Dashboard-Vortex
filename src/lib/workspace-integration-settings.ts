import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";

export interface WorkspaceIntegrationSettings {
  workspace_id: string;
  meta_capi_enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export const DEFAULT_WORKSPACE_INTEGRATION_SETTINGS = {
  meta_capi_enabled: false,
};

interface ProviderConfigFallback {
  integrations?: {
    meta_capi_enabled?: unknown;
  };
  [key: string]: unknown;
}

function parseProviderConfig(content?: string | null): ProviderConfigFallback {
  if (!content) return {};
  try {
    const parsed = JSON.parse(content) as ProviderConfigFallback;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function readProviderConfigFallback(
  workspaceId: string,
  admin: SupabaseClient
): Promise<boolean | null> {
  const { data, error } = await admin
    .from("agent_documents")
    .select("content")
    .eq("workspace_id", workspaceId)
    .eq("doc_type", "provider_config")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const config = parseProviderConfig((data as { content?: string | null }).content);
  const value = config.integrations?.meta_capi_enabled;
  return typeof value === "boolean" ? value : null;
}

async function writeProviderConfigFallback(
  workspaceId: string,
  metaCapiEnabled: boolean,
  admin: SupabaseClient
): Promise<void> {
  const { data } = await admin
    .from("agent_documents")
    .select("id, content")
    .eq("workspace_id", workspaceId)
    .eq("doc_type", "provider_config")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const existing = data as { id?: string; content?: string | null } | null;
  const config = parseProviderConfig(existing?.content);
  const nextConfig: ProviderConfigFallback = {
    ...config,
    integrations: {
      ...(config.integrations || {}),
      meta_capi_enabled: metaCapiEnabled,
    },
  };
  const content = JSON.stringify(nextConfig);

  if (existing?.id) {
    const { error } = await admin
      .from("agent_documents")
      .update({ content, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await admin.from("agent_documents").insert({
    workspace_id: workspaceId,
    doc_type: "provider_config",
    content,
  });
  if (error) throw error;
}

export async function getWorkspaceIntegrationSettings(
  workspaceId: string,
  admin: SupabaseClient = createAdminClient()
): Promise<WorkspaceIntegrationSettings> {
  const { data, error } = await admin
    .from("workspace_integration_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    const fallback = await readProviderConfigFallback(workspaceId, admin);
    return {
      workspace_id: workspaceId,
      meta_capi_enabled: fallback ?? DEFAULT_WORKSPACE_INTEGRATION_SETTINGS.meta_capi_enabled,
    };
  }

  if (!data) {
    const fallback = await readProviderConfigFallback(workspaceId, admin);
    return {
      workspace_id: workspaceId,
      meta_capi_enabled: fallback ?? DEFAULT_WORKSPACE_INTEGRATION_SETTINGS.meta_capi_enabled,
    };
  }

  const row = data as Partial<WorkspaceIntegrationSettings>;
  return {
    workspace_id: workspaceId,
    meta_capi_enabled: row.meta_capi_enabled === true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function isMetaCapiEnabledForWorkspace(
  workspaceId: string,
  admin?: SupabaseClient
): Promise<boolean> {
  const settings = await getWorkspaceIntegrationSettings(
    workspaceId,
    admin ?? createAdminClient()
  );
  return settings.meta_capi_enabled;
}

export async function upsertWorkspaceIntegrationSettings(
  workspaceId: string,
  patch: Partial<Pick<WorkspaceIntegrationSettings, "meta_capi_enabled">>,
  admin: SupabaseClient = createAdminClient()
): Promise<WorkspaceIntegrationSettings> {
  const payload: Partial<WorkspaceIntegrationSettings> & {
    workspace_id: string;
    updated_at: string;
  } = {
    workspace_id: workspaceId,
    updated_at: new Date().toISOString(),
  };

  if (typeof patch.meta_capi_enabled === "boolean") {
    payload.meta_capi_enabled = patch.meta_capi_enabled;
  }

  const { data, error } = await admin
    .from("workspace_integration_settings")
    .upsert(payload, { onConflict: "workspace_id" })
    .select("*")
    .single();

  if (error) {
    if (typeof patch.meta_capi_enabled === "boolean") {
      await writeProviderConfigFallback(workspaceId, patch.meta_capi_enabled, admin);
      return {
        workspace_id: workspaceId,
        meta_capi_enabled: patch.meta_capi_enabled,
        updated_at: payload.updated_at,
      };
    }
    throw error;
  }

  return {
    workspace_id: workspaceId,
    meta_capi_enabled: (data as WorkspaceIntegrationSettings).meta_capi_enabled === true,
    created_at: (data as WorkspaceIntegrationSettings).created_at,
    updated_at: (data as WorkspaceIntegrationSettings).updated_at,
  };
}
