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

    const { data: configs, error } = await supabase
      .from("shelf_configs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("page_type")
      .order("position", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ configs: configs || [] });
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
    const { page_type, position, anchor_selector, algorithm, title, max_products, enabled, tags } = body;

    if (!page_type || !position || !algorithm || !title) {
      return NextResponse.json(
        { error: "Missing required fields: page_type, position, algorithm, title" },
        { status: 400 }
      );
    }

    // Shift existing shelves down if position is occupied
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("shelf_configs")
      .select("id, position")
      .eq("workspace_id", workspaceId)
      .eq("page_type", page_type)
      .gte("position", position)
      .order("position", { ascending: false });

    if (existing && existing.length > 0) {
      for (const config of existing) {
        await admin
          .from("shelf_configs")
          .update({ position: config.position + 1 })
          .eq("id", config.id);
      }
    }

    const { data, error } = await supabase
      .from("shelf_configs")
      .insert({
        workspace_id: workspaceId,
        page_type,
        position,
        anchor_selector: anchor_selector || null,
        algorithm,
        title,
        max_products: max_products || 12,
        enabled: enabled !== false,
        tags: tags || [],
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ config: data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
