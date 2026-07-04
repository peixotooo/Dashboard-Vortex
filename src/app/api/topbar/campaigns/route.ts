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

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("topbar_campaigns")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaigns: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json();
  const content = serializeTopbarSlides(
    body.slides,
    body.title,
    body.message,
    body.link_url,
    body.link_label
  );

  if (!body.name || !content.message) {
    return NextResponse.json({ error: "name and message are required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const next_regenerate_at =
    body.auto_regenerate && body.regenerate_every_hours
      ? new Date(Date.now() + body.regenerate_every_hours * 3600 * 1000).toISOString()
      : null;

  const { data, error } = await admin
    .from("topbar_campaigns")
    .insert({
      workspace_id: auth.workspaceId,
      name: body.name,
      enabled: body.enabled ?? true,
      priority: body.priority ?? 0,
      title: content.title,
      starts_at: body.starts_at || null,
      ends_at: body.ends_at || null,
      recurrence: body.recurrence || "none",
      recurrence_days: body.recurrence_days || null,
      recurrence_window_start: body.recurrence_window_start || null,
      recurrence_window_end: body.recurrence_window_end || null,
      message: content.message,
      link_url: content.link_url,
      link_label: content.link_label,
      countdown_enabled: body.countdown_enabled ?? false,
      countdown_target: body.countdown_target || null,
      countdown_label: body.countdown_label || "Termina em",
      countdown_recurrence: body.countdown_recurrence || "fixed",
      bg_color: body.bg_color || null,
      text_color: body.text_color || null,
      accent_color: body.accent_color || null,
      font_size: body.font_size || null,
      height: body.height || null,
      title_bold: typeof body.title_bold === "boolean" ? body.title_bold : null,
      message_bold: typeof body.message_bold === "boolean" ? body.message_bold : null,
      countdown_bg_color: body.countdown_bg_color || null,
      countdown_text_color: body.countdown_text_color || null,
      countdown_font_weight: body.countdown_font_weight || null,
      countdown_padding:
        (body.countdown_padding || body.countdown_margin)
          ? packCountdownSpacing(body.countdown_padding, body.countdown_margin, "")
          : null,
      countdown_border_radius: body.countdown_border_radius || null,
      show_on_pages: body.show_on_pages || null,
      context_type: body.context_type || null,
      context_brief: body.context_brief || null,
      auto_regenerate: body.auto_regenerate ?? false,
      regenerate_every_hours: body.regenerate_every_hours ?? 24,
      next_regenerate_at,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}
