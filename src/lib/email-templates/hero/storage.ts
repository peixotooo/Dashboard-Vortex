// src/lib/email-templates/hero/storage.ts
//
// Two responsibilities:
//
//  1) persistGeneratedHero: kie.ai delivers short-lived (24h) image URLs. We
//     download the bytes once and re-upload to B2 so the stored hero stays
//     addressable beyond the expiry window.
//
//  2) mirrorToB2: kie.ai's input_urls fetcher 400s on a chunk of perfectly
//     valid URLs (VNDA CDN photos, sometimes our own /hero-refs assets) with
//     "Image fetch failed. Check access settings or use our File Upload API
//     instead." We sidestep the issue by mirroring every input image into B2
//     up-front and passing only B2 public URLs into kie.ai. Mirrored objects
//     are deduped by the hash of the source URL so we re-upload at most once
//     per source.

import { createHash } from "crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { uploadFile, getPublicUrl } from "@/lib/b2-storage";

const MAX_HERO_SOURCE_BYTES = 10 * 1024 * 1024;

function isPrivateIp(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  const version = isIP(host);

  if (version === 4) {
    const [a, b] = host.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    );
  }

  if (version === 6) {
    const normalized = host.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return false;
}

async function validatePublicSourceUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("source URL must be valid");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("source URL must use http or https");
  }

  if (url.username || url.password) {
    throw new Error("source URL must not include credentials");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isPrivateIp(hostname)
  ) {
    throw new Error("source URL must point to a public host");
  }

  const addresses = await lookup(hostname, { all: true }).catch(() => []);
  if (addresses.some((address) => isPrivateIp(address.address))) {
    throw new Error("source URL resolved to a private network address");
  }

  return url;
}

async function fetchPublicImage(rawUrl: string): Promise<{
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
}> {
  let currentUrl = await validatePublicSourceUrl(rawUrl);

  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const res = await fetch(currentUrl.toString(), { redirect: "manual" });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("source URL redirected without a location");
      currentUrl = await validatePublicSourceUrl(new URL(location, currentUrl).toString());
      continue;
    }

    if (!res.ok) {
      throw new Error(`download failed: ${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) {
      throw new Error(`source URL did not return an image: ${contentType}`);
    }

    const contentLength = Number(res.headers.get("content-length") || "0");
    if (contentLength > MAX_HERO_SOURCE_BYTES) {
      throw new Error("source image is too large");
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_HERO_SOURCE_BYTES) {
      throw new Error("source image is too large");
    }

    return { buffer, contentType, finalUrl: currentUrl.toString() };
  }

  throw new Error("source URL redirected too many times");
}

function pickExtension(contentType: string, sourceUrl: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  // Fall back to the URL extension if the content-type is generic.
  const m = sourceUrl.match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i);
  if (m) return m[1].toLowerCase().replace("jpeg", "jpg");
  return "jpg";
}

export async function persistGeneratedHero(args: {
  workspace_id: string;
  vnda_product_id: string;
  layout_id: string;
  slot: number;
  source_url: string;
}): Promise<string> {
  const { buffer, contentType, finalUrl } = await fetchPublicImage(args.source_url);
  const ext = pickExtension(contentType, finalUrl);
  const safeProduct = args.vnda_product_id.replace(/[^a-zA-Z0-9_-]/g, "");
  const stamp = Date.now();
  const key = `email-heroes/${args.workspace_id}/${args.layout_id}/slot${args.slot}-${safeProduct}-${stamp}.${ext}`;
  await uploadFile(key, buffer, contentType);
  return getPublicUrl(key);
}

// In-memory cache of (sourceUrl -> mirrored B2 URL). Cold-start cleared.
// We also write through to B2 with a deterministic key so a fresh process
// will hit the same object on its second call (idempotent).
const _mirrorMemo = new Map<string, string>();

/**
 * Download `sourceUrl` and re-upload it to B2 under a deterministic key, then
 * return the B2 public URL. Idempotent: calling twice with the same source URL
 * returns the same B2 URL (and skips network I/O after the first call within
 * a process).
 */
export async function mirrorToB2(sourceUrl: string): Promise<string> {
  const cached = _mirrorMemo.get(sourceUrl);
  if (cached) return cached;

  const { buffer, contentType, finalUrl } = await fetchPublicImage(sourceUrl);
  const ext = pickExtension(contentType, finalUrl);
  // SHA-256 of the source URL keeps the path stable across deploys/processes.
  const hash = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 24);
  const key = `email-heroes-mirror/${hash}.${ext}`;
  await uploadFile(key, buffer, contentType);
  const url = getPublicUrl(key);
  _mirrorMemo.set(sourceUrl, url);
  return url;
}
