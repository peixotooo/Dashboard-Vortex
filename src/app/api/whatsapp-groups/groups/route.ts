import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWapiConfig, listGroups } from "@/lib/wapi-api";

function createSupabase(request: NextRequest) {
  return createServerClient(
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
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId)
      return NextResponse.json(
        { error: "Workspace not specified" },
        { status: 400 }
      );

    const refresh = request.nextUrl.searchParams.get("refresh") === "true";
    const admin = createAdminClient();

    // If not refreshing, try to return cached groups
    if (!refresh) {
      const { data: cached } = await admin
        .from("wapi_groups")
        .select("group_jid, group_name, synced_at")
        .eq("workspace_id", workspaceId)
        .order("group_name");

      if (cached && cached.length > 0) {
        const groups = cached.map((g) => ({
          id: g.group_jid,
          name: g.group_name,
        }));
        return NextResponse.json({
          groups,
          synced_at: cached[0].synced_at,
          cached: true,
        });
      }
    }

    // Refresh from W-API
    const config = await getWapiConfig(workspaceId);
    if (!config)
      return NextResponse.json(
        { error: "W-API not configured" },
        { status: 400 }
      );

    const raw = await listGroups(config);

    // Normalize W-API response
    let groupList: Array<{ id: string; name: string }> = [];

    if (Array.isArray(raw)) {
      groupList = raw.map((g: Record<string, unknown>) => ({
        id: (g.id || g.jid || g.groupId || "") as string,
        name: (g.name || g.subject || g.groupName || "Sem nome") as string,
      }));
    } else if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const arr = (obj.groups || obj.data || obj.result || []) as Array<
        Record<string, unknown>
      >;
      if (Array.isArray(arr)) {
        groupList = arr.map((g) => ({
          id: (g.id || g.jid || g.groupId || "") as string,
          name: (g.name || g.subject || g.groupName || "Sem nome") as string,
        }));
      }
    }

    // Filter valid groups
    groupList = groupList.filter((g) => g.id && g.id.includes("@g.us"));

    // Upsert into wapi_groups cache
    const now = new Date().toISOString();
    if (groupList.length > 0) {
      const rows = groupList.map((g) => ({
        workspace_id: workspaceId,
        group_jid: g.id,
        group_name: g.name,
        synced_at: now,
      }));

      await admin
        .from("wapi_groups")
        .upsert(rows, { onConflict: "workspace_id,group_jid" });

      // Remove stale groups not in fresh list
      await admin
        .from("wapi_groups")
        .delete()
        .eq("workspace_id", workspaceId)
        .lt("synced_at", now);
    }

    return NextResponse.json({
      groups: groupList,
      synced_at: now,
      cached: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
