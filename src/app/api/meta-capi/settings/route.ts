import { NextRequest, NextResponse } from "next/server";
import { AuthError, getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { isCapiConfigured } from "@/lib/meta-capi";
import {
  getMetaCapiSettings,
  upsertMetaCapiSettings,
} from "@/lib/meta-capi-settings";
import { createAdminClient } from "@/lib/supabase-admin";

function allowedWorkspaceIds(): string[] {
  return (process.env.META_CAPI_VNDA_WORKSPACE_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function meta(settings: { workspace_id: string; storage_ready?: boolean }) {
  const allowed = allowedWorkspaceIds();
  return {
    env_configured: isCapiConfigured(),
    settings_storage_ready: settings.storage_ready !== false,
    vnda_purchase_allowed:
      allowed.length > 0 && allowed.includes(settings.workspace_id),
  };
}

async function assertAdmin(workspaceId: string, userId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!data || !["owner", "admin"].includes(data.role)) {
    throw new AuthError("Admin access required", 403);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const settings = await getMetaCapiSettings(workspaceId);
    return NextResponse.json({ settings, ...meta(settings) });
  } catch (e) {
    return handleAuthError(e);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { userId, workspaceId } = await getWorkspaceContext(request);
    await assertAdmin(workspaceId, userId);
    const body = await request.json();
    const settings = await upsertMetaCapiSettings(workspaceId, {
      enabled: body.enabled,
    });
    return NextResponse.json({ settings, ...meta(settings) });
  } catch (e) {
    return handleAuthError(e);
  }
}
