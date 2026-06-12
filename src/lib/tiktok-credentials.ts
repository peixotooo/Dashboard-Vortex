import { createAdminClient } from "@/lib/supabase-admin";
import { decrypt, encrypt } from "@/lib/encryption";

/**
 * Per-workspace TikTok Marketing API credentials, minted by the OAuth callback
 * (src/app/api/tiktok/callback/route.ts) and stored encrypted in tiktok_credentials
 * (migration-119). The advertiser token is durable (no refresh_token / expiry), so
 * unlike ml_credentials there is nothing to refresh here.
 */
export interface TikTokCredentials {
  accessToken: string;
  advertiserIds: string[];
  scope: number[];
}

function isMissingTableError(
  error: { code?: string; message?: string } | null
): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.message?.includes("tiktok_credentials") === true
  );
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter(Boolean);
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => Number(v)).filter((n) => Number.isFinite(n));
}

/**
 * Reads and decrypts the stored TikTok credentials for a workspace.
 * Returns null when the workspace has not connected TikTok yet, or when the
 * tiktok_credentials table has not been created (migration-119 not applied) —
 * callers should surface a "connect TikTok" state rather than a 500.
 */
export async function getTikTokCredentials(
  workspaceId: string
): Promise<TikTokCredentials | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tiktok_credentials")
    .select("access_token, advertiser_ids, scope")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error && isMissingTableError(error)) return null;
  if (error) throw new Error(error.message);
  if (!data) return null;

  const encryptedToken =
    typeof data.access_token === "string" ? data.access_token.trim() : "";
  if (!encryptedToken) return null;

  return {
    accessToken: decrypt(encryptedToken),
    advertiserIds: asStringArray(data.advertiser_ids),
    scope: asNumberArray(data.scope),
  };
}

/**
 * Encrypts and upserts the TikTok credentials for a workspace. Called by the OAuth
 * callback after exchanging the auth_code for an access token. Single row per
 * workspace (onConflict: workspace_id).
 */
export async function upsertTikTokCredentials(
  workspaceId: string,
  input: {
    accessToken: string;
    advertiserIds: string[];
    scope?: number[];
    appId?: string | null;
  }
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("tiktok_credentials").upsert(
    {
      workspace_id: workspaceId,
      access_token: encrypt(input.accessToken),
      advertiser_ids: input.advertiserIds,
      scope: input.scope || [],
      tiktok_app_id: input.appId || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" }
  );

  if (error) throw new Error(error.message);
}
