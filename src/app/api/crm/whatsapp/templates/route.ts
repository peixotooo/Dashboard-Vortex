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

    // Delete existing templates and re-insert (partial index prevents upsert)
    await admin.from("wa_templates").delete().eq("workspace_id", workspaceId);

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

      const { error: insertError } = await admin.from("wa_templates").insert(rows);
      if (insertError) {
        console.error("[WA Templates] Insert error:", insertError.message);
        throw new Error(`Erro ao salvar templates: ${insertError.message}`);
      }
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
