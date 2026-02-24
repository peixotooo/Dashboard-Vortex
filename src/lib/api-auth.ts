import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { setContextToken } from "@/lib/meta-api";
import { decrypt } from "@/lib/encryption";

interface AuthResult {
  userId: string;
  workspaceId: string;
  accessToken: string;
}

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  // Verify user is a member of this workspace
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    throw new AuthError("Not a member of this workspace", 403);
  }

  // Get the Meta access token for this workspace
  const { data: connection } = await supabase
    .from("meta_connections")
    .select("access_token")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

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
