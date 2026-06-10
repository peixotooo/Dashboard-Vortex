import { createAdminClient } from "@/lib/supabase-admin";

export interface MetaCapiSettings {
  workspace_id: string;
  enabled: boolean;
  storage_ready?: boolean;
}

export const DEFAULT_META_CAPI_SETTINGS = {
  enabled: true,
};

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.message?.includes("meta_capi_settings") === true
  );
}

export async function getMetaCapiSettings(workspaceId: string): Promise<MetaCapiSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("meta_capi_settings")
    .select("workspace_id, enabled")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error && isMissingTableError(error)) {
    return {
      workspace_id: workspaceId,
      ...DEFAULT_META_CAPI_SETTINGS,
      storage_ready: false,
    };
  }

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return {
      workspace_id: workspaceId,
      ...DEFAULT_META_CAPI_SETTINGS,
      storage_ready: true,
    };
  }

  return {
    workspace_id: workspaceId,
    enabled: data.enabled !== false,
    storage_ready: true,
  };
}

export async function isWorkspaceCapiEnabled(workspaceId: string): Promise<boolean> {
  try {
    const settings = await getMetaCapiSettings(workspaceId);
    return settings.enabled;
  } catch {
    // Keep existing tracking alive if the settings read has a transient issue.
    return DEFAULT_META_CAPI_SETTINGS.enabled;
  }
}

export async function upsertMetaCapiSettings(
  workspaceId: string,
  patch: Partial<MetaCapiSettings>
): Promise<MetaCapiSettings> {
  const enabled =
    typeof patch.enabled === "boolean"
      ? patch.enabled
      : DEFAULT_META_CAPI_SETTINGS.enabled;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("meta_capi_settings")
    .upsert(
      {
        workspace_id: workspaceId,
        enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    )
    .select("workspace_id, enabled")
    .single();

  if (error) throw new Error(error.message);

  return {
    workspace_id: data.workspace_id,
    enabled: data.enabled !== false,
    storage_ready: true,
  };
}
