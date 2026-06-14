import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";

function getSupabase(request: NextRequest) {
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
    const supabase = getSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = createAdminClient();
    const workspaceId = request.nextUrl.searchParams.get("workspace_id") || "";

    if (workspaceId) {
      const { data: membership, error: membershipError } = await admin
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (membershipError) throw membershipError;
      if (!membership) {
        return NextResponse.json({ error: "Not a workspace member" }, { status: 403 });
      }

      const { data: members, error: membersError } = await admin
        .from("workspace_members")
        .select("workspace_id, user_id, role, joined_at, features, profile:profiles(full_name)")
        .eq("workspace_id", workspaceId)
        .order("joined_at", { ascending: true });

      if (membersError) throw membersError;
      const normalizedMembers = (members || []).map((member) => ({
        ...member,
        profile: Array.isArray(member.profile) ? member.profile[0] || null : member.profile,
      }));
      return NextResponse.json({ members: normalizedMembers });
    }

    const { data: memberships, error: membershipsError } = await admin
      .from("workspace_members")
      .select("workspace_id, user_id, role, joined_at, features")
      .eq("user_id", user.id)
      .order("joined_at", { ascending: true });

    if (membershipsError) throw membershipsError;

    const workspaceIds = [...new Set((memberships || []).map((member) => member.workspace_id))];
    if (workspaceIds.length === 0) {
      return NextResponse.json({ workspaces: [], memberships: [] });
    }

    const { data: workspaces, error: workspacesError } = await admin
      .from("workspaces")
      .select("id, name, slug, owner_id, created_at, custom_domain")
      .in("id", workspaceIds)
      .order("created_at", { ascending: true });

    if (workspacesError) throw workspacesError;

    const host = (
      request.headers.get("x-forwarded-host") ||
      request.headers.get("host") ||
      ""
    )
      .split(",")[0]
      .trim()
      .toLowerCase()
      .replace(/:\d+$/, "");
    const domainWorkspace = host
      ? (workspaces || []).find((workspace) => workspace.custom_domain?.toLowerCase() === host)
      : null;

    return NextResponse.json({
      workspaces: workspaces || [],
      memberships: memberships || [],
      domainWorkspaceId: domainWorkspace?.id || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
