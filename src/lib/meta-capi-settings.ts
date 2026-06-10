import { createAdminClient } from "@/lib/supabase-admin";
import { decrypt, encrypt } from "@/lib/encryption";

export interface MetaCapiSettings {
  workspace_id: string;
  enabled: boolean;
  pixel_id: string | null;
  has_access_token: boolean;
  storage_ready?: boolean;
}

export const DEFAULT_META_CAPI_SETTINGS = {
  enabled: true,
  pixel_id: null,
  has_access_token: false,
};

export interface MetaCapiCredentials {
  pixelId: string;
  accessToken: string;
}

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
    .select("*")
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
    pixel_id: typeof data.pixel_id === "string" && data.pixel_id.trim()
      ? data.pixel_id.trim()
      : null,
    has_access_token:
      typeof data.access_token_encrypted === "string" &&
      data.access_token_encrypted.trim().length > 0,
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
  const current = await getMetaCapiSettings(workspaceId);
  const enabled =
    typeof patch.enabled === "boolean"
      ? patch.enabled
      : current.enabled;
  const pixelId =
    typeof patch.pixel_id === "string"
      ? patch.pixel_id.trim() || null
      : current.pixel_id;
  if (pixelId && !/^\d+$/.test(pixelId)) {
    throw new Error("Pixel ID deve conter apenas números.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("meta_capi_settings")
    .upsert(
      {
        workspace_id: workspaceId,
        enabled,
        pixel_id: pixelId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  return {
    workspace_id: data.workspace_id,
    enabled: data.enabled !== false,
    pixel_id: typeof data.pixel_id === "string" && data.pixel_id.trim()
      ? data.pixel_id.trim()
      : null,
    has_access_token:
      typeof data.access_token_encrypted === "string" &&
      data.access_token_encrypted.trim().length > 0,
    storage_ready: true,
  };
}

export async function upsertMetaCapiCredentials(
  workspaceId: string,
  patch: {
    enabled?: boolean;
    pixel_id?: string | null;
    access_token?: string | null;
    clear_access_token?: boolean;
  }
): Promise<MetaCapiSettings> {
  const current = await getMetaCapiSettings(workspaceId);
  const enabled =
    typeof patch.enabled === "boolean" ? patch.enabled : current.enabled;
  const pixelId =
    typeof patch.pixel_id === "string"
      ? patch.pixel_id.trim() || null
      : current.pixel_id;
  if (pixelId && !/^\d+$/.test(pixelId)) {
    throw new Error("Pixel ID deve conter apenas números.");
  }

  const payload: Record<string, unknown> = {
    workspace_id: workspaceId,
    enabled,
    pixel_id: pixelId,
    updated_at: new Date().toISOString(),
  };

  if (patch.clear_access_token) {
    payload.access_token_encrypted = null;
  } else if (typeof patch.access_token === "string" && patch.access_token.trim()) {
    payload.access_token_encrypted = encrypt(patch.access_token.trim());
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("meta_capi_settings")
    .upsert(payload, { onConflict: "workspace_id" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  return {
    workspace_id: data.workspace_id,
    enabled: data.enabled !== false,
    pixel_id: typeof data.pixel_id === "string" && data.pixel_id.trim()
      ? data.pixel_id.trim()
      : null,
    has_access_token:
      typeof data.access_token_encrypted === "string" &&
      data.access_token_encrypted.trim().length > 0,
    storage_ready: true,
  };
}

export async function getMetaCapiCredentials(
  workspaceId: string
): Promise<MetaCapiCredentials | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("meta_capi_settings")
    .select("pixel_id, access_token_encrypted")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !data) return null;

  const pixelId =
    typeof data.pixel_id === "string" && data.pixel_id.trim()
      ? data.pixel_id.trim()
      : "";
  const encryptedToken =
    typeof data.access_token_encrypted === "string" &&
    data.access_token_encrypted.trim()
      ? data.access_token_encrypted.trim()
      : "";

  if (!pixelId || !encryptedToken) return null;

  return {
    pixelId,
    accessToken: decrypt(encryptedToken),
  };
}
