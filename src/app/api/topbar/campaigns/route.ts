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
  if (!body.name || !body.message) {
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
      title: body.title || null,
      starts_at: body.starts_at || null,
      ends_at: body.ends_at || null,
      recurrence: body.recurrence || "none",
      recurrence_days: body.recurrence_days || null,
      recurrence_window_start: body.recurrence_window_start || null,
      recurrence_window_end: body.recurrence_window_end || null,
      message: body.message,
      link_url: body.link_url || null,
      link_label: body.link_label || null,
      countdown_enabled: body.countdown_enabled ?? false,
      countdown_target: body.countdown_target || null,
      countdown_label: body.countdown_label || "Termina em",
      countdown_recurrence: body.countdown_recurrence || "fixed",
      bg_color: body.bg_color || null,
      text_color: body.text_color || null,
      accent_color: body.accent_color || null,
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
