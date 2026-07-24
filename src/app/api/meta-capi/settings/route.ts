import { NextRequest, NextResponse } from "next/server";
import {
  getWorkspaceAdminContext,
  getWorkspaceContext,
  handleAuthError,
} from "@/lib/api-auth";
import { isCapiConfigured } from "@/lib/meta-capi";
import {
  getMetaCapiSettings,
  upsertMetaCapiCredentials,
  type MetaCapiSettings,
} from "@/lib/meta-capi-settings";
import { readLimitedJson } from "@/lib/security/webhook-request";

function allowedWorkspaceIds(): string[] {
  return (process.env.META_CAPI_VNDA_WORKSPACE_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function meta(settings: MetaCapiSettings) {
  const allowed = allowedWorkspaceIds();
  const workspaceConfigured = Boolean(settings.pixel_id && settings.has_access_token);
  return {
    env_configured: isCapiConfigured(),
    workspace_credentials_configured: workspaceConfigured,
    effective_configured: isCapiConfigured() || workspaceConfigured,
    settings_storage_ready: settings.storage_ready !== false,
    vnda_purchase_allowed:
      workspaceConfigured ||
      (allowed.length > 0 && allowed.includes(settings.workspace_id)),
  };
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
    const { workspaceId } = await getWorkspaceAdminContext(request);
    const parsed = await readLimitedJson(request, 32 * 1024);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }
    const body = parsed.value as Record<string, unknown>;
    if (
      body.pixel_id !== undefined &&
      (typeof body.pixel_id !== "string" ||
        (body.pixel_id.trim() !== "" &&
          !/^\d{5,40}$/.test(body.pixel_id.trim())))
    ) {
      return NextResponse.json({ error: "pixel_id inválido" }, { status: 400 });
    }
    if (
      body.access_token !== undefined &&
      (typeof body.access_token !== "string" ||
        body.access_token.length > 8192)
    ) {
      return NextResponse.json({ error: "access_token inválido" }, { status: 400 });
    }
    const settings = await upsertMetaCapiCredentials(workspaceId, {
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      pixel_id:
        typeof body.pixel_id === "string" ? body.pixel_id : undefined,
      access_token:
        typeof body.access_token === "string"
          ? body.access_token
          : undefined,
      clear_access_token:
        typeof body.clear_access_token === "boolean"
          ? body.clear_access_token
          : undefined,
    });
    return NextResponse.json({ settings, ...meta(settings) });
  } catch (e) {
    return handleAuthError(e);
  }
}
