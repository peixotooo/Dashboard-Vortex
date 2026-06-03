import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWaConfig, syncTemplatesFromMeta } from "@/lib/whatsapp-api";

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll() {},
      },
    }
  );
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const admin = createAdminClient();
    const { data: templates } = await admin
      .from("wa_templates")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("name");

    return NextResponse.json({ templates: templates || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST = sync templates from Meta API
export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

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

      const metaIds = rows.map((r) => r.meta_id).filter(Boolean);
      const { data: existing, error: existingError } = await admin
        .from("wa_templates")
        .select("meta_id")
        .eq("workspace_id", workspaceId)
        .in("meta_id", metaIds);
      if (existingError) {
        console.error("[WA Templates] Existing lookup error:", existingError.message);
        throw new Error(`Erro ao buscar templates existentes: ${existingError.message}`);
      }

      const existingMetaIds = new Set((existing || []).map((t) => t.meta_id));
      const toInsert = rows.filter((row) => !existingMetaIds.has(row.meta_id));
      const toUpdate = rows.filter((row) => existingMetaIds.has(row.meta_id));

      for (const row of toUpdate) {
        const { workspace_id: _workspaceId, meta_id: _metaId, ...patch } = row;
        const { error: updateError } = await admin
          .from("wa_templates")
          .update(patch)
          .eq("workspace_id", workspaceId)
          .eq("meta_id", row.meta_id);
        if (updateError) {
          console.error("[WA Templates] Update error:", updateError.message);
          throw new Error(`Erro ao atualizar template ${row.name}: ${updateError.message}`);
        }
      }

      if (toInsert.length > 0) {
        const { error: insertError } = await admin.from("wa_templates").insert(toInsert);
        if (insertError) {
          console.error("[WA Templates] Insert error:", insertError.message);
          throw new Error(`Erro ao inserir templates: ${insertError.message}`);
        }
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
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[WA Templates] Sync error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
