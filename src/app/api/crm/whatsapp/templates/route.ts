import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWaConfig, syncTemplatesFromMeta } from "@/lib/whatsapp-api";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();
    const { data: templates } = await admin
      .from("wa_templates")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("name");

    return NextResponse.json({ templates: templates || [] });
  } catch (error) {
    return handleAuthError(error);
  }
}

// POST = sync templates from Meta API
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const config = await getWaConfig(workspaceId);
    if (!config) return NextResponse.json({ error: "WhatsApp não configurado. Salve as credenciais na aba Configuração." }, { status: 400 });

    console.error(`[WA Templates] Syncing for WABA ${config.wabaId}, phone ${config.phoneNumberId}`);
    const metaTemplates = await syncTemplatesFromMeta(config);
    console.error(`[WA Templates] Meta returned ${metaTemplates.length} templates`);
    const admin = createAdminClient();

    // IMPORTANTE: NÃO usar DELETE + INSERT aqui. wa_campaigns.template_id
    // tem FK ON DELETE SET NULL — apagar+reinserir rouba o template das
    // campanhas em andamento (queued/sending), que viram failed no
    // próximo tick do sender. Em vez disso:
    //   1) UPSERT por (workspace_id, meta_id) — mantém o UUID local estável
    //   2) DELETE só dos meta_ids que sumiram da Meta — esses não dão
    //      pra enviar mesmo, então cair pra null + failed é correto.

    if (metaTemplates.length > 0) {
      const rows = metaTemplates.map((t) => ({
        workspace_id: workspaceId,
        meta_id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        components: t.components,
        synced_at: new Date().toISOString(),
      }));

      const { error: upsertError } = await admin
        .from("wa_templates")
        .upsert(rows, { onConflict: "workspace_id,meta_id" });
      if (upsertError) {
        console.error("[WA Templates] Upsert error:", upsertError.message);
        throw new Error(`Erro ao salvar templates: ${upsertError.message}`);
      }
    }

    // Limpar templates que sumiram da Meta (renomeados → meta_id novo,
    // ou deletados). Mantém os que ainda existem.
    const liveMetaIds = metaTemplates.map((t) => t.id).filter(Boolean);
    if (liveMetaIds.length > 0) {
      const { error: deleteError } = await admin
        .from("wa_templates")
        .delete()
        .eq("workspace_id", workspaceId)
        .not("meta_id", "in", `(${liveMetaIds.map((id) => `"${id}"`).join(",")})`);
      if (deleteError) {
        console.error("[WA Templates] Cleanup delete error:", deleteError.message);
        // não falha o sync — só loga
      }
    } else {
      // Meta voltou 0 templates → workspace zerou tudo lá. Limpa local também.
      await admin.from("wa_templates").delete().eq("workspace_id", workspaceId);
    }

    // Re-fetch to return updated list
    const { data: templates } = await admin
      .from("wa_templates")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("name");

    console.error(`[WA Templates] Saved ${(templates || []).length} templates to DB`);

    return NextResponse.json({
      synced: metaTemplates.length,
      templates: templates || [],
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
