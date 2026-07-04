import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError, AuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { getApifyConfigAdmin } from "@/lib/apify-api";
import {
  captureAndPersist,
  resolveTrackedUsername,
  spDateString,
} from "@/lib/instagram/snapshot";

// Apify run-sync (perfil + posts) pode levar até ~60s.
export const maxDuration = 120;

// POST /api/instagram/snapshot — captura on-demand do dia.
// Body opcional: { username } (default = perfil acompanhado pelo workspace).
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

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
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
