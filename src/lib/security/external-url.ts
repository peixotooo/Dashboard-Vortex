import { lookup } from "dns/promises";

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIp(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isPrivateIpv4(normalized)) return true;
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4(normalized.slice("::ffff:".length));
  }
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

export async function validatePublicHttpUrl(rawUrl: string, label = "url"): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label} must use http or https`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not include credentials`);
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isPrivateIp(hostname)
  ) {
    throw new Error(`${label} must point to a public host`);
  }

  const addresses = await lookup(hostname, { all: true }).catch(() => []);
  if (addresses.some((address) => isPrivateIp(address.address))) {
    throw new Error(`${label} resolved to a private network address`);
  }

  return url;
}

export async function fetchPublicHttpUrl(
  rawUrl: string,
  init: RequestInit = {},
  options: { label?: string; maxRedirects?: number } = {}
): Promise<Response> {
  const label = options.label || "url";
  let currentUrl = await validatePublicHttpUrl(rawUrl, label);
  const maxRedirects = options.maxRedirects ?? 3;

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = await fetch(currentUrl.toString(), {
      ...init,
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`${label} redirected without a location`);
      currentUrl = await validatePublicHttpUrl(new URL(location, currentUrl).toString(), label);
      continue;
    }

    return response;
  }

  throw new Error(`${label} redirected too many times`);
}

export async function readPublicUrlBuffer(
  rawUrl: string,
  options: {
    label?: string;
    maxBytes?: number;
    allowedContentTypes?: RegExp;
  } = {}
): Promise<{ buffer: Buffer; contentType: string; finalUrl: string }> {
  const response = await fetchPublicHttpUrl(rawUrl, {}, { label: options.label });
  if (!response.ok) throw new Error(`Failed to download ${options.label || "url"}: HTTP ${response.status}`);

  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
  const length = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(length) && length > maxBytes) {
    throw new Error(`${options.label || "url"} is too large`);
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  if (options.allowedContentTypes && !options.allowedContentTypes.test(contentType)) {
    throw new Error(`${options.label || "url"} has unsupported content type`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw new Error(`${options.label || "url"} is too large`);

  return { buffer, contentType, finalUrl: response.url || rawUrl };
}
