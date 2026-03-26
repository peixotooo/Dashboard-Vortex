import { createAdminClient } from "@/lib/supabase-admin";

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;

function generateShortCode(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(7);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const b of bytes) code += chars[b % chars.length];
  return code;
}

async function getWorkspaceDomain(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
): Promise<string> {
  const { data } = await admin
    .from("workspaces")
    .select("custom_domain")
    .eq("id", workspaceId)
    .single();

  if (data?.custom_domain) {
    return `https://${data.custom_domain}`;
  }

  return process.env.NEXT_PUBLIC_APP_URL || "https://app.vortexds.com.br";
}

/**
 * Detect URLs in message text, append UTM params, shorten them,
 * and return the processed text with short links.
 */
export async function processMessageLinks(
  text: string,
  workspaceId: string,
  dispatchId?: string
): Promise<string> {
  const urls = text.match(URL_REGEX);
  if (!urls || urls.length === 0) return text;

  const admin = createAdminClient();
  const baseDomain = await getWorkspaceDomain(admin, workspaceId);
  let processed = text;

  // Deduplicate URLs
  const uniqueUrls = [...new Set(urls)];

  for (const url of uniqueUrls) {
    // Skip if already has UTM params
    const hasUtm = url.includes("utm_source");
    const sep = url.includes("?") ? "&" : "?";
    const finalUrl = hasUtm
      ? url
      : `${url}${sep}utm_source=whatsapp_grupos&utm_medium=wapi&utm_campaign=grupos`;

    const shortCode = generateShortCode();

    try {
      await admin.from("wapi_short_links").insert({
        workspace_id: workspaceId,
        short_code: shortCode,
        original_url: url,
        final_url: finalUrl,
        dispatch_id: dispatchId || null,
      });

      const shortUrl = `${baseDomain}/l/${shortCode}`;
      processed = processed.replaceAll(url, shortUrl);
    } catch {
      // If insert fails (unlikely short_code collision), skip shortening this URL
      // Still add UTMs to the original URL
      processed = processed.replaceAll(url, finalUrl);
    }
  }

  return processed;
}
