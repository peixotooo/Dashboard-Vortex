import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { listMarketingActions, createMarketingAction, getCategoryColor } from "@/lib/agent/memory";
import { syncMarketingToProjectContext } from "@/lib/agent/marketing-sync";

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

// GET /api/marketing/actions?start=2026-03-01&end=2026-03-31&category=campanha&status=planned
export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const url = new URL(request.url);
    const ptParam = url.searchParams.get("planning_type");
    const planningType: "social" | "performance" | undefined =
      ptParam === "social" || ptParam === "performance" ? ptParam : undefined;
    const filters = {
      start: url.searchParams.get("start") || undefined,
      end: url.searchParams.get("end") || undefined,
      category: url.searchParams.get("category") || undefined,
      status: url.searchParams.get("status") || undefined,
      planning_type: planningType,
    };

    const actions = await listMarketingActions(supabase, workspaceId, filters);

    // Add color to each action based on category
    const actionsWithColor = actions.map((a) => ({
      ...a,
      color: getCategoryColor(a.category),
    }));

    return NextResponse.json({ actions: actionsWithColor });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/marketing/actions
export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const body = await request.json();
    const action = await createMarketingAction(supabase, workspaceId, {
      ...body,
      created_by: user.id,
    });

    // Sync to project context (non-blocking)
    syncMarketingToProjectContext(supabase, workspaceId).catch(() => {});

    return NextResponse.json(
      { action: { ...action, color: getCategoryColor(action.category) } },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
