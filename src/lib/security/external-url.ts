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

function parsePublicHttpUrl(rawUrl: string, label: string): URL {
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

  return url;
}

export function normalizePublicBrowserUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length > 2048) return null;
  try {
    return parsePublicHttpUrl(rawUrl.trim(), "url").toString();
  } catch {
    return null;
  }
}

export async function validatePublicHttpUrl(rawUrl: string, label = "url"): Promise<URL> {
  const url = parsePublicHttpUrl(rawUrl, label);
  const hostname = url.hostname.toLowerCase();
  const addresses = await lookup(hostname, { all: true }).catch(() => []);
  if (addresses.length === 0) {
    throw new Error(`${label} could not be resolved`);
  }
  if (addresses.some((address) => isPrivateIp(address.address))) {
    throw new Error(`${label} resolved to a private network address`);
  }

  return url;
}

function stripSensitiveRedirectHeaders(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  headers.delete("proxy-authorization");
  return { ...init, headers };
}

export async function fetchPublicHttpUrl(
  rawUrl: string,
  init: RequestInit = {},
  options: {
    label?: string;
    maxRedirects?: number;
    allowCrossOriginRedirects?: boolean;
  } = {}
): Promise<Response> {
  const label = options.label || "url";
  let currentUrl = await validatePublicHttpUrl(rawUrl, label);
  const maxRedirects = options.maxRedirects ?? 3;
  let currentInit = { ...init };

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = await fetch(currentUrl.toString(), {
      ...currentInit,
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`${label} redirected without a location`);
      const nextUrl = await validatePublicHttpUrl(
        new URL(location, currentUrl).toString(),
        label
      );
      if (nextUrl.origin !== currentUrl.origin) {
        if (options.allowCrossOriginRedirects === false) {
          throw new Error(`${label} redirected to a different origin`);
        }
        currentInit = stripSensitiveRedirectHeaders(currentInit);
      }

      const method = (currentInit.method || "GET").toUpperCase();
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          method === "POST")
      ) {
        const headers = new Headers(currentInit.headers);
        headers.delete("content-length");
        headers.delete("content-type");
        currentInit = {
          ...currentInit,
          method: "GET",
          body: undefined,
          headers,
        };
      }

      currentUrl = nextUrl;
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
    timeoutMs?: number;
  } = {}
): Promise<{ buffer: Buffer; contentType: string; finalUrl: string }> {
  const timeoutMs = Math.max(500, Math.min(options.timeoutMs ?? 15_000, 60_000));
  const response = await fetchPublicHttpUrl(
    rawUrl,
    { signal: AbortSignal.timeout(timeoutMs) },
    { label: options.label }
  );
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

  if (!response.body) {
    return { buffer: Buffer.alloc(0), contentType, finalUrl: response.url || rawUrl };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`${options.label || "url"} is too large`);
    }
    chunks.push(value);
  }

  const buffer = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    totalBytes
  );

  return { buffer, contentType, finalUrl: response.url || rawUrl };
}
