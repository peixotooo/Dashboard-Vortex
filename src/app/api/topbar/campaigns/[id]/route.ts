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

async function authorize(request: NextRequest) {
  const supabase = createSupabase(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", status: 401 as const };

  const workspaceId = request.headers.get("x-workspace-id") || "";
  if (!workspaceId) return { error: "Workspace not specified", status: 400 as const };

  return { user, workspaceId };
}

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: RouteCtx) {
  const auth = await authorize(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const [campaignRes, variationsRes] = await Promise.all([
    admin
      .from("topbar_campaigns")
      .select("*")
      .eq("id", id)
      .eq("workspace_id", auth.workspaceId)
      .maybeSingle(),
    admin
      .from("topbar_variations")
      .select("*")
      .eq("campaign_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (campaignRes.error)
    return NextResponse.json({ error: campaignRes.error.message }, { status: 500 });
  if (!campaignRes.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    campaign: campaignRes.data,
    variations: variationsRes.data || [],
  });
}

export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  const auth = await authorize(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;

  const body = await request.json();
  const admin = createAdminClient();

  const allowed = [
    "name",
    "enabled",
    "priority",
    "title",
    "starts_at",
    "ends_at",
    "recurrence",
    "recurrence_days",
    "recurrence_window_start",
    "recurrence_window_end",
    "message",
    "link_url",
    "link_label",
    "countdown_enabled",
    "countdown_target",
    "countdown_label",
    "countdown_recurrence",
    "bg_color",
    "text_color",
    "accent_color",
    "font_size",
    "height",
    "title_bold",
    "message_bold",
    "countdown_bg_color",
    "countdown_text_color",
    "countdown_font_weight",
    "countdown_padding",
    "countdown_border_radius",
    "show_on_pages",
    "context_type",
    "context_brief",
    "auto_regenerate",
    "regenerate_every_hours",
  ] as const;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  // Recalcula next_regenerate_at se auto_regenerate ou regenerate_every_hours mudou
  if ("auto_regenerate" in body || "regenerate_every_hours" in body) {
    const autoRegen = body.auto_regenerate ?? false;
    const everyH = body.regenerate_every_hours ?? 24;
    patch.next_regenerate_at = autoRegen
      ? new Date(Date.now() + everyH * 3600 * 1000).toISOString()
      : null;
  }

  const { data, error } = await admin
    .from("topbar_campaigns")
    .update(patch)
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}

export async function DELETE(request: NextRequest, ctx: RouteCtx) {
  const auth = await authorize(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { error } = await admin
    .from("topbar_campaigns")
    .delete()
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
