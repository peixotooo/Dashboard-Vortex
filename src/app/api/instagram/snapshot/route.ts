import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { getApifyConfigAdmin } from "@/lib/apify-api";
import {
  captureAndPersist,
  resolveTrackedUsername,
  spDateString,
} from "@/lib/instagram/snapshot";

// Apify run-sync (perfil + posts) pode levar até ~60s.
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

// POST /api/instagram/snapshot — captura on-demand do dia.
// Body opcional: { username } (default = perfil acompanhado pelo workspace).
export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const admin = createAdminClient();

    const username = await resolveTrackedUsername(admin, workspaceId, body?.username);
    if (!username) {
      return NextResponse.json(
        { error: "Nenhum perfil do Instagram configurado. Informe um @username." },
        { status: 400 }
      );
    }

    const config = await getApifyConfigAdmin(admin, workspaceId);
    if (!config) return NextResponse.json({ error: "Apify não configurado para este workspace" }, { status: 400 });

    const captured = await captureAndPersist(admin, config, workspaceId, username, {
      source: "manual",
      postsLimit: 30,
    });

    return NextResponse.json({
      capturedOn: spDateString(),
      username,
      profile: captured.profile,
      metrics: captured.metrics,
      postsCount: captured.posts.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
