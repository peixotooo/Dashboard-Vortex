import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { setContextToken } from "@/lib/meta-api";
import { decrypt } from "@/lib/encryption";
import { createAdminClient } from "@/lib/supabase-admin";
import { canAccessFeature } from "@/lib/features";

interface AuthResult {
  userId: string;
  workspaceId: string;
  accessToken: string;
}

// Helper for timeout
const withTimeout = async <T>(promise: Promise<T> | T, timeoutMs: number): Promise<T | null> => {
  const timeoutPromise = new Promise<null>((resolve) => 
    setTimeout(() => resolve(null), timeoutMs)
  );
  return Promise.race([promise as Promise<T>, timeoutPromise]);
};

const API_FEATURE_REQUIREMENTS: Array<
  [prefix: string, anyOfFeatures: string[]]
> = [
  ["/api/crm/email-templates", ["crm.email_templates"]],
  ["/api/crm/cart-recovery", ["crm.cart_recovery"]],
  ["/api/cart-recovery", ["crm.cart_recovery"]],
  ["/api/crm/whatsapp", ["crm.whatsapp"]],
  ["/api/promo-tags", ["loja.promo_tags"]],
  ["/api/gift-request", ["loja.gift_request"]],
  ["/api/gift-bar", ["loja.gift_bar"]],
  ["/api/reviews", ["loja.reviews"]],
  ["/api/assistant", ["loja.assistente"]],
  ["/api/whatsapp-groups", ["crm.whatsapp_groups"]],
  ["/api/cashback", ["crm.cashback"]],
  ["/api/topbar", ["loja.topbar"]],
  ["/api/coupons", ["loja.coupons"]],
  ["/api/shelves", ["loja.shelves"]],
  ["/api/products", ["loja.products"]],
  ["/api/bio", ["canais.bio"]],
  ["/api/instagram-accounts", ["meta_ads"]],
  ["/api/instagram", ["instagram"]],
  ["/api/mcp", ["meta_ads"]],
  ["/api/google-ads", ["google_ads"]],
  ["/api/tiktok-ads", ["tiktok_ads"]],
  ["/api/tiktok", ["tiktok_ads"]],
  ["/api/campaigns", ["meta_ads.campaigns"]],
  ["/api/adsets", ["meta_ads.campaigns"]],
  ["/api/ads", ["meta_ads.campaigns"]],
  ["/api/audiences", ["meta_ads.audiences"]],
  ["/api/creatives", ["meta_ads.creatives"]],
  ["/api/accounts", ["meta_ads"]],
  ["/api/auth", ["meta_ads"]],
  ["/api/insights", ["meta_ads", "overview", "financeiro"]],
  ["/api/ga4", ["ga4", "overview", "financeiro", "loja.vnda"]],
  ["/api/agent", ["agent"]],
  ["/api/pre-cadastro", ["hub.pre_cadastro"]],
  ["/api/eccosys", ["hub"]],
  ["/api/hub", ["hub"]],
  ["/api/ml", ["hub"]],
  ["/api/sync", ["hub"]],
  ["/api/pricing", ["financeiro.pricing"]],
  ["/api/simulador-comercial", ["financeiro.comercial"]],
  ["/api/financeiro", ["financeiro"]],
  ["/api/controladoria", ["controladoria"]],
  ["/api/media", ["media"]],
  ["/api/marketing", ["team.planning"]],
  ["/api/team", ["team"]],
  ["/api/comms", ["crm"]],
  ["/api/crm", ["crm"]],
  ["/api/checkout", ["overview", "crm"]],
];

function requiredFeaturesForRequest(request: NextRequest): string[] | null {
  const pathname = new URL(request.url).pathname;
  const match = API_FEATURE_REQUIREMENTS.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  return match?.[1] ?? null;
}

function hasRequiredFeature(
  requiredFeatures: string[] | null,
  role: string | null,
  features: string[] | null
): boolean {
  return (
    !requiredFeatures ||
    requiredFeatures.some((featureId) =>
      canAccessFeature(featureId, role, features)
    )
  );
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function trustedDashboardOrigins(request: NextRequest): Set<string> {
  const values = [
    new URL(request.url).origin,
    process.env.NEXT_PUBLIC_APP_URL || "",
    process.env.APP_URL || "",
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "",
    ...(process.env.DASHBOARD_ALLOWED_ORIGINS || "").split(","),
  ];
  return new Set(
    values
      .map((value) => normalizeOrigin(value.trim()))
      .filter((value): value is string => Boolean(value))
  );
}

/**
 * Cookie-authenticated browser mutations must originate from this dashboard.
 * Origin-less server-to-server calls remain supported; Sec-Fetch-Site still
 * rejects modern browsers attempting a cross-site form submission.
 */
export function assertTrustedMutationOrigin(request: NextRequest): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return;

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    throw new AuthError("Cross-site request blocked", 403);
  }

  const originHeader = request.headers.get("origin");
  if (!originHeader) return;
  const origin = normalizeOrigin(originHeader);
  if (!origin || !trustedDashboardOrigins(request).has(origin)) {
    throw new AuthError("Untrusted request origin", 403);
  }
}

export async function getAuthenticatedContext(
  request: NextRequest
): Promise<AuthResult> {
  assertTrustedMutationOrigin(request);
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {
          // Read-only in API routes
        },
      },
    }
  );

  const authResponse = await withTimeout(supabase.auth.getUser(), 3000);
  const user = (authResponse as any)?.data?.user || null;

  if (!user) {
    throw new AuthError("Not authenticated", 401);
  }

  // Get workspace_id from header or query param
  const workspaceId =
    request.headers.get("x-workspace-id") ||
    new URL(request.url).searchParams.get("workspace_id") ||
    "";

  if (!workspaceId) {
    throw new AuthError("Workspace not specified", 400);
  }

  // Verify membership and get Meta connection in parallel
  const [membershipResponse, connectionResponse] = await Promise.all([
    withTimeout(
      supabase
        .from("workspace_members")
        .select("role, features")
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id)
        .single(),
      2000
    ),
    withTimeout(
      supabase
        .from("meta_connections")
        .select("access_token")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
      2000
    ),
  ]);

  const membership = (membershipResponse as any)?.data;

  if (!membership) {
    throw new AuthError("Not a member of this workspace (or request timed out)", 403);
  }

  const requiredFeatures = requiredFeaturesForRequest(request);
  if (
    !hasRequiredFeature(
      requiredFeatures,
      membership.role ?? null,
      membership.features ?? null
    )
  ) {
    throw new AuthError(
      `Feature access required: ${requiredFeatures?.join(" or ")}`,
      403
    );
  }

  const connection = (connectionResponse as any)?.data;

  if (!connection?.access_token) {
    throw new AuthError("No Meta connection configured for this workspace", 400);
  }

  const decryptedToken = decrypt(connection.access_token);
  return {
    userId: user.id,
    workspaceId,
    accessToken: decryptedToken,
  };
}

/**
 * Resolve the Meta access token for a SPECIFIC ad account in a workspace.
 *
 * Multi-connection support: each `meta_accounts` row links to a `connection_id`,
 * so an account from a different Meta app/business uses its own token. Falls
 * back to the workspace's latest connection (legacy single-token behavior) so
 * single-connection workspaces are unaffected. Returns null when no connection
 * exists — callers keep the env/global fallback already set by requireAuth.
 *
 * Uses the admin client so it also works in crons/aggregators.
 */
export async function resolveTokenForAccount(
  workspaceId: string,
  accountId: string
): Promise<string | null> {
  if (!workspaceId || !accountId || accountId === "all") return null;
  const admin = createAdminClient();

  // account_id may be stored with or without the "act_" prefix
  const variants = accountId.startsWith("act_")
    ? [accountId, accountId.slice(4)]
    : [accountId, `act_${accountId}`];

  // 1) account -> its connection's token
  const { data: acct } = await admin
    .from("meta_accounts")
    .select("connection_id, meta_connections(access_token)")
    .eq("workspace_id", workspaceId)
    .in("account_id", variants)
    .limit(1)
    .maybeSingle();
  const mc = (acct as { meta_connections?: unknown } | null)?.meta_connections;
  const enc = Array.isArray(mc)
    ? (mc[0] as { access_token?: string } | undefined)?.access_token
    : (mc as { access_token?: string } | undefined)?.access_token;
  if (enc) {
    try {
      return decrypt(enc);
    } catch {
      /* fall through to workspace default */
    }
  }

  // 2) fallback: workspace's latest connection (legacy single-token path)
  const { data: conn } = await admin
    .from("meta_connections")
    .select("access_token")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (conn?.access_token) {
    try {
      return decrypt(conn.access_token);
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function requireMetaTokenForRequest(
  workspaceId: string,
  accountId: string | null | undefined,
  defaultAccessToken: string
): Promise<string> {
  if (accountId && accountId !== "all") {
    const token = await resolveTokenForAccount(workspaceId, accountId);
    if (!token) {
      throw new AuthError("No Meta token configured for this account", 400);
    }
    return token;
  }

  return defaultAccessToken;
}

/**
 * Resolve and set the global Meta context token for a specific account.
 * Returns true if a token was resolved and applied. No-op (returns false)
 * when no per-account/workspace token exists, leaving the existing context.
 */
export async function setTokenForAccount(
  workspaceId: string,
  accountId: string
): Promise<boolean> {
  const tok = await resolveTokenForAccount(workspaceId, accountId);
  if (tok) {
    setContextToken(tok);
    return true;
  }
  return false;
}

/**
 * Lightweight authenticated context for endpoints that don't need a Meta token.
 * Verifies the user session, workspace membership, and mapped feature access.
 */
export async function getWorkspaceContext(
  request: NextRequest
): Promise<{ userId: string; workspaceId: string }> {
  assertTrustedMutationOrigin(request);
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {
          // Read-only in API routes
        },
      },
    }
  );

  const authResponse = await withTimeout(supabase.auth.getUser(), 3000);
  const user = (authResponse as { data?: { user?: { id: string } | null } } | null)?.data?.user ?? null;
  if (!user) throw new AuthError("Not authenticated", 401);

  const workspaceId =
    request.headers.get("x-workspace-id") ||
    new URL(request.url).searchParams.get("workspace_id") ||
    "";
  if (!workspaceId) throw new AuthError("Workspace not specified", 400);

  const membership = await withTimeout(
    supabase
      .from("workspace_members")
      .select("role, features")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single(),
    2000
  );

  const membershipData = (
    membership as {
      data?: { role?: string | null; features?: string[] | null } | null;
    } | null
  )?.data;
  if (!membershipData) {
    throw new AuthError("Not a member of this workspace (or request timed out)", 403);
  }

  const requiredFeatures = requiredFeaturesForRequest(request);
  if (
    !hasRequiredFeature(
      requiredFeatures,
      membershipData.role ?? null,
      membershipData.features ?? null
    )
  ) {
    throw new AuthError(
      `Feature access required: ${requiredFeatures?.join(" or ")}`,
      403
    );
  }

  return { userId: user.id, workspaceId };
}

/**
 * Workspace context for routes that mutate communication rules or customer
 * data. getWorkspaceContext proves membership; this second check prevents a
 * regular member from bypassing the dashboard and calling a service-role route
 * directly.
 */
export async function getWorkspaceAdminContext(
  request: NextRequest
): Promise<{ userId: string; workspaceId: string }> {
  const context = await getWorkspaceContext(request);
  const admin = createAdminClient();
  const { data: membership, error } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", context.workspaceId)
    .eq("user_id", context.userId)
    .maybeSingle();

  if (error || !membership) {
    throw new AuthError("Not a member of this workspace", 403);
  }
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new AuthError("Admin role required", 403);
  }
  return context;
}

/**
 * Like getWorkspaceContext, but ALSO enforces access to the restricted
 * "controladoria" feature: owner/admin, or a member whose features array
 * explicitly includes "controladoria". Members with features === null (legacy
 * "see everything") do NOT get it. Use in every /api/controladoria/* route so
 * the access control isn't only client-side.
 */
export async function getControladoriaContext(
  request: NextRequest
): Promise<{ userId: string; workspaceId: string }> {
  assertTrustedMutationOrigin(request);
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return request.cookies.getAll(); }, setAll() {} } }
  );
  const authResponse = await withTimeout(supabase.auth.getUser(), 3000);
  const user = (authResponse as { data?: { user?: { id: string } | null } } | null)?.data?.user ?? null;
  if (!user) throw new AuthError("Not authenticated", 401);

  const workspaceId =
    request.headers.get("x-workspace-id") ||
    new URL(request.url).searchParams.get("workspace_id") ||
    "";
  if (!workspaceId) throw new AuthError("Workspace not specified", 400);

  const membership = await withTimeout(
    supabase
      .from("workspace_members")
      .select("role, features")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single(),
    2000
  );
  const data = (membership as { data?: { role?: string; features?: string[] | null } } | null)?.data;
  if (!data) throw new AuthError("Not a member of this workspace (or request timed out)", 403);

  const isPrivileged = data.role === "owner" || data.role === "admin";
  const hasFeature = Array.isArray(data.features) && data.features.includes("controladoria");
  if (!isPrivileged && !hasFeature) {
    throw new AuthError("Acesso à Controladoria restrito", 403);
  }
  return { userId: user.id, workspaceId };
}

/**
 * Resolve the workspace for a hub sync route that is legitimately called BOTH
 * from the dashboard (user session) and from trusted server-to-server callers
 * with no session — the ML webhook and ops/backfill jobs. Internal callers
 * present the shared service secret (CRON_SECRET) plus x-workspace-id; everyone
 * else goes through the normal session + membership check (getWorkspaceContext).
 *
 * This restores the pre-#199 server-to-server capability of /api/sync/* without
 * reopening the IDOR: a raw x-workspace-id header alone is no longer trusted —
 * the caller must also hold CRON_SECRET.
 */
export async function getSyncWorkspace(
  request: NextRequest
): Promise<{ workspaceId: string; internal: boolean }> {
  const secret = request.headers.get("x-internal-secret");
  if (secret && process.env.CRON_SECRET && secret === process.env.CRON_SECRET) {
    const workspaceId =
      request.headers.get("x-workspace-id") ||
      new URL(request.url).searchParams.get("workspace_id") ||
      "";
    if (!workspaceId) throw new AuthError("Workspace not specified", 400);
    return { workspaceId, internal: true };
  }
  const { workspaceId } = await getWorkspaceContext(request);
  return { workspaceId, internal: false };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function handleAuthError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error("[api-auth]", message);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
