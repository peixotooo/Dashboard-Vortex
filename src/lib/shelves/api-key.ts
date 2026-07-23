import { createAdminClient } from "@/lib/supabase-admin";
import {
  DEFAULT_SHELF_SOURCE,
  normalizeShelfSource,
  shelfSourceColumnsAvailable,
  type ShelfSource,
} from "@/lib/shelves/source";

interface ApiKeyResult {
  workspaceId: string;
  /** Loja dona da chave: 'vnda' (legada) ou 'medusa' (app.bulking.com.br). */
  source: ShelfSource;
}

/**
 * Validates a public API key and returns the associated workspace ID + source.
 * Used by public-facing endpoints (recommend, track, config).
 *
 * Tolerante à migration-143: se a coluna `source` ainda não existir no banco,
 * valida como antes e assume 'vnda' (comportamento legado intacto).
 */
export async function validateApiKey(
  key: string | null
): Promise<ApiKeyResult | null> {
  if (!key) return null;

  const admin = createAdminClient();
  const hasSource = await shelfSourceColumnsAvailable();

  const { data, error } = await admin
    .from("shelf_api_keys")
    .select(hasSource ? "workspace_id, source" : "workspace_id")
    .eq("key", key)
    .eq("active", true)
    .limit(1)
    .single<{ workspace_id: string; source?: string }>();

  if (error || !data?.workspace_id) return null;

  return {
    workspaceId: data.workspace_id,
    source: hasSource ? normalizeShelfSource(data.source) : DEFAULT_SHELF_SOURCE,
  };
}
