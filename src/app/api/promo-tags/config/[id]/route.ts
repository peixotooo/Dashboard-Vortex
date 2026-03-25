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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const body = await request.json();

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("promo_tag_configs")
      .update({
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        ...(body.name && { name: body.name }),
        ...(body.priority !== undefined && { priority: body.priority }),
        ...(body.match_type && { match_type: body.match_type }),
        ...(body.match_value && { match_value: body.match_value }),
        ...(body.badge_text && { badge_text: body.badge_text }),
        ...(body.badge_bg_color && { badge_bg_color: body.badge_bg_color }),
        ...(body.badge_text_color && { badge_text_color: body.badge_text_color }),
        ...(body.badge_font_size && { badge_font_size: body.badge_font_size }),
        ...(body.badge_border_radius && {
          badge_border_radius: body.badge_border_radius,
        }),
        ...(body.badge_position && { badge_position: body.badge_position }),
        ...(body.badge_padding && { badge_padding: body.badge_padding }),
        ...(body.show_on_pages && { show_on_pages: body.show_on_pages }),
      })
      .eq("id", id)
      .eq("workspace_id", workspaceId)
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    const admin = createAdminClient();
    const { error } = await admin
      .from("promo_tag_configs")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
