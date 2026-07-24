import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getWorkspaceContext,
  handleAuthError,
} from "@/lib/api-auth";

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
  let context: { userId: string; workspaceId: string };
  try {
    context = await getWorkspaceContext(request);
  } catch (error) {
    return { error: handleAuthError(error) };
  }

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", context.workspaceId)
    .eq("user_id", context.userId)
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
      userId: context.userId,
      workspaceId: context.workspaceId,
      role,
      admin,
    },
  };
}
