import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";

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
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Workspace not specified" },
        { status: 400 }
      );
    }

    const { data: rules, error } = await supabase
      .from("promo_tag_configs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("priority", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ rules: rules || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Workspace not specified" },
        { status: 400 }
      );
    }

    const body = await request.json();

    if (!body.name || !body.match_type || !body.match_value || !body.badge_text) {
      return NextResponse.json(
        { error: "name, match_type, match_value, and badge_text are required" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("promo_tag_configs")
      .insert({
        workspace_id: workspaceId,
        enabled: body.enabled ?? true,
        name: body.name,
        priority: body.priority ?? 0,
        match_type: body.match_type,
        match_value: body.match_value,
        badge_text: body.badge_text,
        badge_bg_color: body.badge_bg_color || "#ff0000",
        badge_text_color: body.badge_text_color || "#ffffff",
        badge_font_size: body.badge_font_size || "11px",
        badge_border_radius: body.badge_border_radius || "4px",
        badge_position: body.badge_position || "top-left",
        badge_padding: body.badge_padding || "4px 8px",
        show_on_pages: body.show_on_pages || ["all"],
        badge_type: body.badge_type || "static",
        badge_placement: body.badge_placement || "auto",
        viewers_min: body.viewers_min ?? 6,
        viewers_max: body.viewers_max ?? 42,
        starts_at: body.starts_at || null,
        ends_at: body.ends_at || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ rule: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
