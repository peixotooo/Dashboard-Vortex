import { createAdminClient } from "@/lib/supabase-admin";

const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_ORIGINS = [
  "https://bulking.com.br",
  "https://www.bulking.com.br",
  "https://checkout.bulking.com.br",
  "https://dash.bulking.com.br",
  "https://chat.bulking.com.br",
  "https://dashboard-vortex.vercel.app",
];

const cache = new Map<string, { expiresAt: number; origins: Set<string> }>();

export function normalizeStorefrontOrigin(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && parsed.hostname === "localhost")
    ) {
      return null;
    }
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

function configuredOrigins(): Set<string> {
  const configured = (
    process.env.STOREFRONT_ALLOWED_ORIGINS ||
    process.env.CHECKOUT_EVENTS_ALLOWED_ORIGINS ||
    ""
  )
    .split(",")
    .map((origin) => normalizeStorefrontOrigin(origin.trim()))
    .filter((origin): origin is string => Boolean(origin));

  return new Set(configured.length > 0 ? configured : DEFAULT_ORIGINS);
}

function originsFromStoreHost(value: string | null | undefined): string[] {
  if (!value) return [];
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const normalized = normalizeStorefrontOrigin(withProtocol);
  if (!normalized) return [];

  const parsed = new URL(normalized);
  const hosts = new Set([parsed.hostname.toLowerCase()]);
  if (parsed.hostname.startsWith("www.")) {
    hosts.add(parsed.hostname.slice(4).toLowerCase());
  } else {
    hosts.add(`www.${parsed.hostname.toLowerCase()}`);
  }

  return [...hosts].map((host) => `https://${host}`);
}

async function loadOrigins(workspaceId?: string): Promise<Set<string>> {
  const cacheKey = workspaceId || "*";
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.origins;
  }

  const origins = configuredOrigins();
  const admin = createAdminClient();
  let query = admin
    .from("vnda_connections")
    .select("workspace_id, store_host")
    .not("store_host", "is", null);
  if (workspaceId) query = query.eq("workspace_id", workspaceId);

  const { data, error } = await query;
  if (!error) {
    for (const row of data || []) {
      for (const origin of originsFromStoreHost(row.store_host as string | null)) {
        origins.add(origin);
      }
    }
  }

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, origins });
  return origins;
}

export async function isKnownStorefrontOrigin(origin: string | null): Promise<boolean> {
  const normalized = normalizeStorefrontOrigin(origin);
  if (!normalized) return process.env.NODE_ENV !== "production" && !origin;
  return (await loadOrigins()).has(normalized);
}

export async function isWorkspaceStorefrontOrigin(
  workspaceId: string,
  origin: string | null
): Promise<boolean> {
  const normalized = normalizeStorefrontOrigin(origin);
  if (!normalized) return process.env.NODE_ENV !== "production" && !origin;
  return (await loadOrigins(workspaceId)).has(normalized);
}

export function storefrontCorsHeaders(
  origin: string | null,
  allowed: boolean
): Record<string, string> {
  const normalized = normalizeStorefrontOrigin(origin);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };

  if (allowed && normalized) {
    headers["Access-Control-Allow-Origin"] = normalized;
  }
  return headers;
}
