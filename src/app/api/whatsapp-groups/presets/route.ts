import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { filterVisibleGroupJids } from "@/lib/whatsapp/group-visibility";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("wapi_group_presets")
      .select("id, name, group_jids, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("name");

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      presets: (data || [])
        .filter((preset) => !String(preset.name || "").startsWith("__pool__:"))
        .map((preset) => ({
          ...preset,
          group_jids: filterVisibleGroupJids(preset.group_jids || []),
        })),
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { workspaceId, userId } = await getWorkspaceContext(request);

    const body = await request.json();
    const { name, group_jids } = body as {
      name: string;
      group_jids: string[];
    };

    const visibleGroupJids = Array.isArray(group_jids)
      ? filterVisibleGroupJids(group_jids)
      : [];

    if (!name || visibleGroupJids.length === 0) {
      return NextResponse.json(
        { error: "Name and at least one group required" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("wapi_group_presets")
      .insert({
        workspace_id: workspaceId,
        name,
        group_jids: visibleGroupJids,
        created_by: userId,
      })
      .select("id, name, group_jids")
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ preset: data });
  } catch (error) {
    return handleAuthError(error);
  }
}
