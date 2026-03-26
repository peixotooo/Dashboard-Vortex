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
      const isEccosysRedirect =
        url.includes("eccosys.com.br") && !url.includes("cdn.eccosys.com.br");
      if (!isEccosysRedirect) {
        resolved.push(url);
        continue;
      }
      // Follow redirect chain manually (max 2 hops)
      const res = await fetch(url, { method: "HEAD", redirect: "manual" });
      const location = res.headers.get("location");
      if (location) {
        const res2 = await fetch(location, {
          method: "HEAD",
          redirect: "manual",
        });
        const location2 = res2.headers.get("location");
        resolved.push(location2 || location);
      } else if (res.ok) {
        resolved.push(url);
      } else {
        resolved.push(url);
      }
    } catch {
      resolved.push(url);
    }
  }
  return resolved;
}
