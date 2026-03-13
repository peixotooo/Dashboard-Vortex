import { createAdminClient } from "@/lib/supabase-admin";

interface ApiKeyResult {
  workspaceId: string;
}

/**
 * Validates a public API key and returns the associated workspace ID.
 * Used by public-facing endpoints (recommend, track, config).
 */
export async function validateApiKey(
  key: string | null
): Promise<ApiKeyResult | null> {
  if (!key) return null;

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("shelf_api_keys")
    .select("workspace_id")
    .eq("key", key)
    .eq("active", true)
    .limit(1)
    .single();

  if (error || !data?.workspace_id) return null;

  return { workspaceId: data.workspace_id as string };
}
