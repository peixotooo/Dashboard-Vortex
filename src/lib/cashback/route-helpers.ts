import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RouteAuth {
  userId: string;
  workspaceId: string;
  role: "owner" | "admin" | "member" | null;
  admin: SupabaseClient;
}

export async function authRoute(
  request: NextRequest,
  opts?: { requireAdmin?: boolean }
): Promise<{ auth?: RouteAuth; error?: NextResponse }> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }

  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId) {
    return { error: NextResponse.json({ error: "Missing x-workspace-id" }, { status: 400 }) };
  }

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return { error: NextResponse.json({ error: "Not a workspace member" }, { status: 403 }) };
  }

  const role = membership.role as RouteAuth["role"];
  if (opts?.requireAdmin && role !== "owner" && role !== "admin") {
    return { error: NextResponse.json({ error: "Admin role required" }, { status: 403 }) };
  }

  return {
    auth: {
      userId: user.id,
      workspaceId,
      role,
      admin,
    },
  };
}
