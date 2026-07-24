import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

export interface SecurityRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  distributed: boolean;
}

const fallbackBuckets = new Map<
  string,
  { count: number; resetAt: number }
>();
let warnedAboutFallback = false;

export function getRequestClientIp(request: NextRequest): string {
  const raw =
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    "";
  let candidate = raw.trim().replace(/^"|"$/g, "");
  if (/^\[[0-9a-f:]+\]:\d+$/i.test(candidate)) {
    candidate = candidate.slice(1, candidate.lastIndexOf("]"));
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }
  return isIP(candidate) ? candidate : "unknown";
}

function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fallbackRateLimit(input: {
  scope: string;
  keyHash: string;
  limit: number;
  windowSeconds: number;
  cost: number;
}): SecurityRateLimitResult {
  const now = Date.now();
  const bucketKey = `${input.scope}:${input.keyHash}`;
  const current = fallbackBuckets.get(bucketKey);
  const bucket =
    current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + input.windowSeconds * 1000 };
  bucket.count += input.cost;
  fallbackBuckets.set(bucketKey, bucket);

  if (fallbackBuckets.size > 10_000) {
    for (const [key, value] of fallbackBuckets) {
      if (value.resetAt <= now) fallbackBuckets.delete(key);
    }
  }

  return {
    allowed: bucket.count <= input.limit,
    remaining: Math.max(input.limit - bucket.count, 0),
    resetAt: new Date(bucket.resetAt),
    distributed: false,
  };
}

export async function consumeSecurityRateLimit(input: {
  scope: string;
  key: string;
  limit: number;
  windowSeconds?: number;
  cost?: number;
}): Promise<SecurityRateLimitResult> {
  const scope = input.scope.toLowerCase().replace(/[^a-z0-9:_-]/g, "").slice(0, 80);
  const keyHash = hashKey(input.key);
  const limit = Math.max(1, Math.min(1_000_000, Math.trunc(input.limit)));
  const windowSeconds = Math.max(
    1,
    Math.min(86_400, Math.trunc(input.windowSeconds ?? 60))
  );
  const cost = Math.max(1, Math.min(10_000, Math.trunc(input.cost ?? 1)));

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("consume_security_rate_limit", {
      p_scope: scope,
      p_key_hash: keyHash,
      p_window_seconds: windowSeconds,
      p_limit: limit,
      p_cost: cost,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) throw error || new Error("Empty rate-limit response");

    return {
      allowed: Boolean(row.allowed),
      remaining: Math.max(0, Number(row.remaining) || 0),
      resetAt: new Date(row.reset_at),
      distributed: true,
    };
  } catch (error) {
    if (!warnedAboutFallback) {
      warnedAboutFallback = true;
      console.warn(
        "[security-rate-limit] Using local fallback:",
        error instanceof Error ? error.message : "RPC unavailable"
      );
    }
    return fallbackRateLimit({
      scope,
      keyHash,
      limit,
      windowSeconds,
      cost,
    });
  }
}

export function securityRateLimitHeaders(
  result: SecurityRateLimitResult,
  limit: number
): Record<string, string> {
  return {
    "RateLimit-Limit": String(limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(
      Math.max(0, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000))
    ),
  };
}
