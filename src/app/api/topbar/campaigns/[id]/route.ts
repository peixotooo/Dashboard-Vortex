import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, AuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { packCountdownSpacing } from "@/lib/topbar/countdown-spacing";
import { serializeTopbarSlides } from "@/lib/topbar/slides";

// Verifica sessão + membership no workspace (getWorkspaceContext) e devolve
// o workspaceId confiável. Não confia no header x-workspace-id cru.
async function authorize(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    return { workspaceId };
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: error.message, status: error.status };
    }
    return { error: "Internal server error", status: 500 as const };
  }
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

  if ("countdown_padding" in body || "countdown_margin" in body) {
    patch.countdown_padding =
      (body.countdown_padding || body.countdown_margin)
        ? packCountdownSpacing(body.countdown_padding, body.countdown_margin, "")
        : null;
  }

  if ("slides" in body) {
    const content = serializeTopbarSlides(
      body.slides,
      body.title,
      body.message,
      body.link_url,
      body.link_label
    );
    if (!content.message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }
    patch.title = content.title;
    patch.message = content.message;
    patch.link_url = content.link_url;
    patch.link_label = content.link_label;
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
