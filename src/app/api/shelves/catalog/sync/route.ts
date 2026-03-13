import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { syncCatalog } from "@/lib/shelves/catalog-sync";

export const maxDuration = 120;

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

    const result = await syncCatalog(workspaceId);

    return NextResponse.json({
      ok: true,
      synced: result.synced,
      errors: result.errors,
      total: result.total,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Catalog Sync]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
