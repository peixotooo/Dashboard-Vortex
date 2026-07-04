import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getWorkspaceContext, handleAuthError, AuthError } from "@/lib/api-auth";

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

export async function POST(request: NextRequest) {
  try {
    const { userId, workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const body = await request.json();
    const { export_type, filters, record_count } = body;

    if (!export_type || typeof record_count !== "number") {
      return NextResponse.json({ error: "Missing export_type or record_count" }, { status: 400 });
    }

    const { error } = await supabase.from("crm_export_logs").insert({
      workspace_id: workspaceId,
      exported_by: userId,
      export_type,
      filters: filters || null,
      record_count,
    });

    if (error) {
      console.error("[CRM Export Log] Insert error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CRM Export Log] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const { data, error } = await supabase
      .from("crm_export_logs")
      .select("id, export_type, filters, record_count, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[CRM Export Log] Fetch error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ logs: data || [] });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CRM Export Log] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
