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
    .from("topbar_configs")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data || null });
}

export async function PUT(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json();
  const admin = createAdminClient();

  // hide_on_pages: sempre garante cart e checkout (guard reforçado)
  const baseHide = Array.isArray(body.hide_on_pages) ? body.hide_on_pages : [];
  const hide_on_pages = Array.from(new Set([...baseHide, "cart", "checkout"]));

  const { data, error } = await admin
    .from("topbar_configs")
    .upsert(
      {
        workspace_id: auth.workspaceId,
        enabled: body.enabled ?? false,
        bg_color: body.bg_color || "#0f172a",
        text_color: body.text_color || "#ffffff",
        accent_color: body.accent_color || "#22c55e",
        font_size: body.font_size || "14px",
        height: body.height || "40px",
        sticky: body.sticky ?? true,
        position: body.position || "top",
        show_close_button: body.show_close_button ?? true,
        close_persistence_hours: body.close_persistence_hours ?? 24,
        show_on_pages: Array.isArray(body.show_on_pages) ? body.show_on_pages : ["all"],
        hide_on_pages,
        ai_enabled: body.ai_enabled ?? false,
        ai_context: body.ai_context || null,
        ai_brand_voice: body.ai_brand_voice || null,
        ai_model: body.ai_model || "openrouter/auto",
        ai_variations_per_run: body.ai_variations_per_run ?? 3,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}
