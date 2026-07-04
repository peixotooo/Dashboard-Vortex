import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  deleteGroupPool,
  listGroupPools,
  slugifyGroupPool,
  syncPoolGroupsFromWapi,
  updateGroupPool,
} from "@/lib/whatsapp/group-pools";

async function ensurePoolWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  workspaceId: string
) {
  const { data, error } = await admin
    .from("wapi_group_presets")
    .select("id, workspace_id, name")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .like("name", "__pool__:%")
    .single();

  if (error || !data) throw new Error(error?.message || "Pool not found");
  return data as { id: string; workspace_id: string; name: string };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { workspaceId } = await getWorkspaceContext(request);

    const body = await request.json();
    const admin = createAdminClient();
    const existing = await ensurePoolWorkspace(admin, id, workspaceId);
    const parsed = JSON.parse((existing.name || "").replace(/^__pool__:/, "") || "{}") as Record<string, unknown>;
    const nextSlug = "slug" in body ? slugifyGroupPool(String(body.slug || "")) : String(parsed.slug || "");
    const nextConfig = {
      name: "name" in body ? String(body.name || "").trim() : String(parsed.name || ""),
      slug: nextSlug,
      matchPattern:
        "matchPattern" in body || "match_pattern" in body
          ? String(body.matchPattern || body.match_pattern || "").trim() || null
          : (parsed.matchPattern as string | null) || null,
      capacity:
        "capacity" in body
          ? Number.parseInt(String(body.capacity), 10)
          : Number(parsed.capacity || 1024),
      nearFullThreshold:
        "nearFullThreshold" in body || "near_full_threshold" in body
          ? Number.parseInt(String(body.nearFullThreshold || body.near_full_threshold), 10)
          : Number(parsed.nearFullThreshold || 950),
      active: "active" in body ? Boolean(body.active) : parsed.active !== false,
      groupOverrides:
        (parsed.groupOverrides as Record<string, { status?: "active" | "paused" | "full" | "archived"; sequence?: number | null }>) ||
        {},
    };

    if (!nextConfig.name || !nextConfig.slug) {
      return NextResponse.json({ error: "Nome e slug sao obrigatorios" }, { status: 400 });
    }
    if (!Number.isFinite(nextConfig.capacity) || nextConfig.capacity <= 0) {
      return NextResponse.json({ error: "Capacidade invalida" }, { status: 400 });
    }
    if (
      !Number.isFinite(nextConfig.nearFullThreshold) ||
      nextConfig.nearFullThreshold <= 0 ||
      nextConfig.nearFullThreshold > nextConfig.capacity
    ) {
      return NextResponse.json({ error: "Limite de alerta invalido" }, { status: 400 });
    }

    const syncResult =
      body.sync === true ? await syncPoolGroupsFromWapi(admin, workspaceId) : null;

    await updateGroupPool(
      admin,
      workspaceId,
      id,
      nextConfig,
      Array.isArray(body.groups) ? (body.groups as Array<Record<string, unknown>>) : []
    );

    const pools = await listGroupPools(admin, workspaceId, request.nextUrl.origin);
    return NextResponse.json({ pools, syncResult });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();
    await ensurePoolWorkspace(admin, id, workspaceId);
    await deleteGroupPool(admin, workspaceId, id);

    const pools = await listGroupPools(admin, workspaceId, request.nextUrl.origin);
    return NextResponse.json({ pools });
  } catch (error) {
    return handleAuthError(error);
  }
}
