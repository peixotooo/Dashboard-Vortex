import { NextRequest } from "next/server";

const BODY_LIMIT_BYTES = 16 * 1024;
const RATE_WINDOW_MS = 60 * 1000;

const allowedPublicHosts = new Set([
  "bulking.com.br",
  "www.bulking.com.br",
  "dash.bulking.com.br",
  "bio.bulking.com.br",
  "grupos.bulking.com.br",
  "localhost",
  "127.0.0.1",
]);

type RateBucket = {
  count: number;
  resetAt: number;
};

const rateBuckets = new Map<string, RateBucket>();

export function normalizeBioHost(value: string | null): string {
  return (value || "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
}

export function isAllowedBioPublicHost(host: string): boolean {
  const normalized = normalizeBioHost(host);
  return (
    allowedPublicHosts.has(normalized) ||
    normalized.endsWith(".bulking.com.br")
  );
}

export function isAllowedBioOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const originHost = normalizeBioHost(new URL(origin).host);
    const requestHost = normalizeBioHost(
      request.headers.get("x-forwarded-host") || request.headers.get("host")
    );
    return originHost === requestHost || isAllowedBioPublicHost(originHost);
  } catch {
    return false;
  }
}

export function buildBioCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !isAllowedBioOrigin(request)) return { Vary: "Origin" };

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export function isBioRequestBodyTooLarge(request: NextRequest): boolean {
  const length = Number(request.headers.get("content-length") || 0);
  return Number.isFinite(length) && length > BODY_LIMIT_BYTES;
}

export function getBioClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function checkBioRateLimit(
  key: string,
  limit: number,
  now = Date.now()
): boolean {
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }

  current.count += 1;
  return current.count <= limit;
}

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export function isValidBioWorkspaceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function sanitizeBioMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};

  const path = cleanString(raw.path, 200);
  if (path) metadata.path = path;

  const blockCount = Number(raw.block_count);
  if (Number.isFinite(blockCount)) {
    metadata.block_count = Math.max(0, Math.min(Math.floor(blockCount), 100));
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}
