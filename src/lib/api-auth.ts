import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { setContextToken } from "@/lib/meta-api";
import { decrypt } from "@/lib/encryption";

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

export async function getAuthenticatedContext(
  request: NextRequest
): Promise<AuthResult> {
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
        .select("role")
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

  const connection = (connectionResponse as any)?.data;

  if (!connection?.access_token) {
    // Fallback to env var during migration
    const envToken = process.env.META_ACCESS_TOKEN;
    if (!envToken) {
      throw new AuthError("No Meta connection configured for this workspace", 400);
    }
    setContextToken(envToken);
    return { userId: user.id, workspaceId, accessToken: envToken };
  }

  const decryptedToken = decrypt(connection.access_token);
  setContextToken(decryptedToken);
  return {
    userId: user.id,
    workspaceId,
    accessToken: decryptedToken,
  };
}

/**
 * Lightweight authenticated context for endpoints that don't need a Meta token.
 * Verifies the user session and workspace membership only.
 */
export async function getWorkspaceContext(
  request: NextRequest
): Promise<{ userId: string; workspaceId: string }> {
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
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single(),
    2000
  );

  if (!(membership as { data?: unknown } | null)?.data) {
    throw new AuthError("Not a member of this workspace (or request timed out)", 403);
  }

  return { userId: user.id, workspaceId };
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
  return NextResponse.json({ error: message }, { status: 500 });
}
