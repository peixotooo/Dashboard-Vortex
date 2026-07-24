import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getWorkspaceContext, handleAuthError, AuthError } from "@/lib/api-auth";
import { getMarketingAction, updateMarketingAction, deleteMarketingAction, getCategoryColor } from "@/lib/agent/memory";
import { syncMarketingToProjectContext } from "@/lib/agent/marketing-sync";
import { readLimitedJson } from "@/lib/security/webhook-request";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

// GET /api/marketing/actions/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }
    const action = await getMarketingAction(supabase, id, workspaceId);
    if (!action) return NextResponse.json({ error: "Action not found" }, { status: 404 });

    return NextResponse.json({ action: { ...action, color: getCategoryColor(action.category) } });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[marketing/actions/:id]", message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/marketing/actions/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }
    const parsed = await readLimitedJson(request, 128 * 1024);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body =
      parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
        ? (parsed.value as {
            title?: string;
            description?: string;
            category?: string;
            planning_type?: "social" | "performance";
            start_date?: string;
            end_date?: string;
            status?: string;
            content?: object;
          })
        : {};
    const action = await updateMarketingAction(
      supabase,
      id,
      body,
      workspaceId
    );

    // Sync to project context (non-blocking)
    syncMarketingToProjectContext(supabase, workspaceId).catch(() => {});

    return NextResponse.json({ action: { ...action, color: getCategoryColor(action.category) } });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[marketing/actions/:id]", message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/marketing/actions/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const supabase = createSupabase(request);

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }
    await deleteMarketingAction(supabase, id, workspaceId);

    // Sync to project context (non-blocking)
    syncMarketingToProjectContext(supabase, workspaceId).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[marketing/actions/:id]", message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
