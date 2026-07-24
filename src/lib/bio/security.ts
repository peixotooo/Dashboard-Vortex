import { NextRequest } from "next/server";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
} from "@/lib/security/rate-limit";

const allowedPublicHosts = new Set([
  "bulking.com.br",
  "www.bulking.com.br",
  "dash.bulking.com.br",
  "bio.bulking.com.br",
  "grupos.bulking.com.br",
  "localhost",
  "127.0.0.1",
]);

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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export function getBioClientIp(request: NextRequest): string {
  return getRequestClientIp(request);
}

export async function checkBioRateLimit(
  key: string,
  limit: number
): Promise<boolean> {
  const result = await consumeSecurityRateLimit({
    scope: "bio:public",
    key,
    limit,
    windowSeconds: 60,
  });
  return result.allowed;
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
