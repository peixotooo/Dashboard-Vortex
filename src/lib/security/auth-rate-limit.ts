import type { NextRequest } from "next/server";
import {
  consumeSecurityRateLimit,
  getRequestClientIp,
  securityRateLimitHeaders,
  type SecurityRateLimitResult,
} from "@/lib/security/rate-limit";

type AuthRateLimitAction = "login" | "recover";
type RateLimitKey = "ip" | "ip_email";

interface AuthRateLimitPolicy {
  scope: string;
  key: RateLimitKey;
  limit: number;
  windowSeconds: number;
}

interface EvaluatedPolicy {
  policy: AuthRateLimitPolicy;
  result: SecurityRateLimitResult;
}

export interface AuthRateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  headers: Record<string, string>;
}

const LOGIN_POLICIES: readonly AuthRateLimitPolicy[] = [
  { scope: "auth:login:ip:15m", key: "ip", limit: 40, windowSeconds: 15 * 60 },
  { scope: "auth:login:ip:24h", key: "ip", limit: 200, windowSeconds: 24 * 60 * 60 },
  { scope: "auth:login:pair:5m", key: "ip_email", limit: 5, windowSeconds: 5 * 60 },
  { scope: "auth:login:pair:30m", key: "ip_email", limit: 10, windowSeconds: 30 * 60 },
  { scope: "auth:login:pair:24h", key: "ip_email", limit: 20, windowSeconds: 24 * 60 * 60 },
];

const RECOVERY_POLICIES: readonly AuthRateLimitPolicy[] = [
  { scope: "auth:recover:ip:15m", key: "ip", limit: 5, windowSeconds: 15 * 60 },
  { scope: "auth:recover:ip:24h", key: "ip", limit: 20, windowSeconds: 24 * 60 * 60 },
  { scope: "auth:recover:pair:1h", key: "ip_email", limit: 3, windowSeconds: 60 * 60 },
  { scope: "auth:recover:pair:24h", key: "ip_email", limit: 5, windowSeconds: 24 * 60 * 60 },
];

const AUTH_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function normalizeAuthEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !AUTH_EMAIL_PATTERN.test(email)) {
    return null;
  }
  return email;
}

function selectGoverningPolicy(evaluated: EvaluatedPolicy[]): EvaluatedPolicy {
  const blocked = evaluated
    .filter(({ result }) => !result.allowed)
    .sort((left, right) => right.result.resetAt.getTime() - left.result.resetAt.getTime());

  if (blocked[0]) return blocked[0];

  return evaluated.reduce((selected, candidate) =>
    candidate.result.remaining < selected.result.remaining ? candidate : selected
  );
}

async function evaluatePolicies(
  policies: readonly AuthRateLimitPolicy[],
  ip: string,
  normalizedEmail: string
): Promise<EvaluatedPolicy[]> {
  return Promise.all(
    policies.map(async (policy): Promise<EvaluatedPolicy> => ({
      policy,
      result: await consumeSecurityRateLimit({
        scope: policy.scope,
        key: policy.key === "ip" ? ip : `${ip}:${normalizedEmail}`,
        limit: policy.limit,
        windowSeconds: policy.windowSeconds,
      }),
    }))
  );
}

function toDecision(evaluated: EvaluatedPolicy[]): AuthRateLimitDecision {
  const governing = selectGoverningPolicy(evaluated);
  const allowed = evaluated.every(({ result }) => result.allowed);
  const retryAfterSeconds = allowed
    ? 0
    : Math.max(
        1,
        Math.ceil((governing.result.resetAt.getTime() - Date.now()) / 1000)
      );

  return {
    allowed,
    retryAfterSeconds,
    headers: securityRateLimitHeaders(governing.result, governing.policy.limit),
  };
}

export async function consumeAuthRateLimits(
  request: NextRequest,
  action: AuthRateLimitAction,
  normalizedEmail: string
): Promise<AuthRateLimitDecision> {
  const ip = getRequestClientIp(request);
  const policies = action === "login" ? LOGIN_POLICIES : RECOVERY_POLICIES;
  const ipPolicies = policies.filter((policy) => policy.key === "ip");
  const pairPolicies = policies.filter((policy) => policy.key === "ip_email");

  const ipResults = await evaluatePolicies(ipPolicies, ip, normalizedEmail);
  const ipDecision = toDecision(ipResults);
  if (!ipDecision.allowed) return ipDecision;

  const pairResults = await evaluatePolicies(pairPolicies, ip, normalizedEmail);
  return toDecision([...ipResults, ...pairResults]);
}
