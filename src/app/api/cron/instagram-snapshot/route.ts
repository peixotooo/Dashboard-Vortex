import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getApifyConfigAdmin } from "@/lib/apify-api";
import { captureAndPersist } from "@/lib/instagram/snapshot";

// Scrape de perfil + posts via Apify pode levar ~60s por perfil.
export const maxDuration = 300;

// GET /api/cron/instagram-snapshot
// Diário: para cada workspace com token Apify + perfil cadastrado, grava o
// snapshot do dia (seguidores + engajamento) em instagram_snapshots.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const results: { workspaceId: string; username: string; followers?: number; error?: string }[] = [];

  try {
    // Workspaces que têm token Apify configurado.
    const { data: connections } = await admin
      .from("apify_connections")
      .select("workspace_id");

    const workspaceIds = Array.from(
      new Set((connections || []).map((c) => c.workspace_id as string))
    );

    if (workspaceIds.length === 0) {
      return NextResponse.json({ message: "Nenhum workspace com Apify", results: [] });
    }

    // Perfis acompanhados por esses workspaces.
    const { data: profiles } = await admin
      .from("instagram_profiles")
      .select("workspace_id, username")
      .in("workspace_id", workspaceIds);

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ message: "Nenhum perfil cadastrado", results: [] });
    }

    for (const { workspace_id: workspaceId, username } of profiles) {
      try {
        const config = await getApifyConfigAdmin(admin, workspaceId);
        if (!config) {
          results.push({ workspaceId, username, error: "Apify não configurado" });
          continue;
        }

        const captured = await captureAndPersist(admin, config, workspaceId, username, {
          source: "cron",
          // Posts suficientes pro engajamento + ranking, sem estourar custo.
          postsLimit: 12,
        });

        results.push({
          workspaceId,
          username,
          followers: captured.profile.followersCount,
        });
        console.log(
          `[Instagram Snapshot] ${workspaceId}/${username}: ${captured.profile.followersCount} seguidores, ER ${captured.metrics.engagementRate ?? "-"}%`
        );
      } catch (err) {
        console.error(`[Instagram Snapshot] Erro em ${workspaceId}/${username}:`, err);
        results.push({ workspaceId, username, error: String(err) });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[Instagram Snapshot] Erro fatal:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
