import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { autoRegenerateCampaign } from "@/lib/topbar/generate";

export const maxDuration = 300;

/**
 * Roda de hora em hora. Pega todas as campanhas com auto_regenerate=true
 * e next_regenerate_at <= now, gera novas variações via OpenRouter,
 * seleciona a primeira como ativa e reagenda.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: campaigns, error } = await admin
    .from("topbar_campaigns")
    .select("id, workspace_id, name, next_regenerate_at")
    .eq("enabled", true)
    .eq("auto_regenerate", true)
    .or(`next_regenerate_at.is.null,next_regenerate_at.lte.${nowIso}`)
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{ id: string; name: string; ok: boolean; error?: string }> = [];

  for (const campaign of campaigns || []) {
    try {
      await autoRegenerateCampaign({
        workspaceId: campaign.workspace_id,
        campaignId: campaign.id,
      });
      results.push({ id: campaign.id, name: campaign.name, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      results.push({ id: campaign.id, name: campaign.name, ok: false, error: msg });

      // Mesmo em erro, avança next_regenerate_at em 1h pra evitar loop quente
      await admin
        .from("topbar_campaigns")
        .update({
          next_regenerate_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        })
        .eq("id", campaign.id);
    }
  }

  return NextResponse.json({
    processed: results.length,
    results,
  });
}
