import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  getWorkspaceAdminContext,
  getWorkspaceContext,
  handleAuthError,
} from "@/lib/api-auth";
import { readLimitedJson } from "@/lib/security/webhook-request";

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

    const { data: keys, error } = await supabase
      .from("shelf_api_keys")
      .select("id, key, name, active, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ keys: keys || [] });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceAdminContext(request);
    const supabase = createSupabase(request);

    const parsed = await readLimitedJson(request, 8 * 1024);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body =
      parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
        ? (parsed.value as Record<string, unknown>)
        : {};
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim().slice(0, 100)
        : "default";

    const { data, error } = await supabase
      .from("shelf_api_keys")
      .insert({
        workspace_id: workspaceId,
        name,
      })
      .select("id, key, name, active, created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ key: data }, { status: 201 });
  } catch (error) {
    return handleAuthError(error);
  }
}
