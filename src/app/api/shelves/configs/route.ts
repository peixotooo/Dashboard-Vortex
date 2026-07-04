import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";

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
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

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
    return handleAuthError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const body = await request.json();
    const { page_type, position, anchor_selector, algorithm, title, max_products, enabled, tags, price_min, price_max } = body;

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
        price_min: price_min != null && price_min !== "" ? Number(price_min) : null,
        price_max: price_max != null && price_max !== "" ? Number(price_max) : null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ config: data }, { status: 201 });
  } catch (error) {
    return handleAuthError(error);
  }
}
