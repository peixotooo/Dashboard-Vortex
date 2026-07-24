import { fetchPublicHttpUrl } from "@/lib/security/external-url";

/**
 * Resolve Eccosys image URLs that do 302 redirects (with PHPSESSID cookie)
 * to their final CDN URLs. ML and other services can't follow these redirects.
 *
 * URLs already on cdn.eccosys.com.br or non-Eccosys URLs are returned as-is.
 */
export async function resolveEccosysImageUrls(
  urls: string[]
): Promise<string[]> {
  const resolved: string[] = [];
  for (const url of urls) {
    if (!url) continue;
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      const isEccosysRedirect =
        parsed.protocol === "https:" &&
        (hostname === "eccosys.com.br" ||
          hostname.endsWith(".eccosys.com.br")) &&
        hostname !== "cdn.eccosys.com.br";
      if (!isEccosysRedirect) {
        resolved.push(url);
        continue;
      }
      const response = await fetchPublicHttpUrl(
        parsed.toString(),
        { method: "HEAD", signal: AbortSignal.timeout(8000) },
        {
          label: "Eccosys image",
          maxRedirects: 2,
        }
      );
      resolved.push(response.ok && response.url ? response.url : url);
    } catch {
      resolved.push(url);
    }
  }
  return resolved;
}
