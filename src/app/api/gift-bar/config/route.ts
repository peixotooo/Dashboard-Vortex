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

    const { data: config, error } = await supabase
      .from("gift_bar_configs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ config: config || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
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

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("gift_bar_configs")
      .upsert(
        {
          workspace_id: workspaceId,
          enabled: body.enabled ?? false,
          threshold: body.threshold ?? 299,
          gift_name: body.gift_name ?? "brinde exclusivo",
          gift_description: body.gift_description || null,
          gift_image_url: body.gift_image_url || null,
          message_progress:
            body.message_progress ||
            "Faltam R$ {remaining} para ganhar {gift}!",
          message_achieved:
            body.message_achieved || "Parabéns! Você ganhou {gift}!",
          message_empty:
            body.message_empty ||
            "Adicione R$ {threshold} em produtos e ganhe {gift}!",
          bar_color: body.bar_color || "#10b981",
          bar_bg_color: body.bar_bg_color || "#e5e7eb",
          text_color: body.text_color || "#1f2937",
          bg_color: body.bg_color || "#ffffff",
          achieved_bg_color: body.achieved_bg_color || "#ecfdf5",
          achieved_text_color: body.achieved_text_color || "#065f46",
          font_size: body.font_size || "14px",
          bar_height: body.bar_height || "8px",
          position: body.position || "top",
          show_on_pages: body.show_on_pages || ["all"],
          steps: Array.isArray(body.steps) ? body.steps : [],
          message_next_step:
            body.message_next_step ||
            "Faltam R$ {gap} para o proximo {next_label}!",
          message_all_achieved:
            body.message_all_achieved || "Voce desbloqueou todos os mimos!",
          show_product_benefits: body.show_product_benefits === true,
          product_benefits: Array.isArray(body.product_benefits)
            ? body.product_benefits
            : [],
          product_benefits_title:
            body.product_benefits_title || "Nossos benefícios",
          product_benefits_anchor: body.product_benefits_anchor || null,
        },
        { onConflict: "workspace_id" }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ config: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
