import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getWorkspaceIntegrationSettings,
  upsertWorkspaceIntegrationSettings,
} from "@/lib/workspace-integration-settings";

async function isWorkspaceAdmin(workspaceId: string, userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  const role = (data as { role?: string } | null)?.role;
  return role === "owner" || role === "admin";
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const settings = await getWorkspaceIntegrationSettings(workspaceId);
    return NextResponse.json({ settings });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { workspaceId, userId } = await getWorkspaceContext(request);
    if (!(await isWorkspaceAdmin(workspaceId, userId))) {
      return NextResponse.json(
        { error: "Sem permissao para alterar integracoes" },
        { status: 403 }
      );
    }

    const body = (await request.json()) as { meta_capi_enabled?: unknown };
    if (typeof body.meta_capi_enabled !== "boolean") {
      return NextResponse.json(
        { error: "meta_capi_enabled must be boolean" },
        { status: 400 }
      );
    }

    const settings = await upsertWorkspaceIntegrationSettings(workspaceId, {
      meta_capi_enabled: body.meta_capi_enabled,
    });
    return NextResponse.json({ settings });
  } catch (error) {
    return handleAuthError(error);
  }
}
