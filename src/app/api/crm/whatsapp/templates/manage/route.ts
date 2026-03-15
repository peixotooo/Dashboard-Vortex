import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getWaConfig,
  createTemplateOnMeta,
  deleteTemplateOnMeta,
} from "@/lib/whatsapp-api";

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

// POST = create a new template on Meta + store locally
export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const config = await getWaConfig(workspaceId);
    if (!config) {
      return NextResponse.json(
        { error: "WhatsApp nao configurado. Salve as credenciais na aba Configuracao." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { name, language, category, components } = body;

    // Validate required fields
    if (!name || !language || !category || !components) {
      return NextResponse.json(
        { error: "Campos obrigatorios: name, language, category, components" },
        { status: 400 }
      );
    }

    // Validate template name format
    if (!/^[a-z0-9_]+$/.test(name) || name.length > 512) {
      return NextResponse.json(
        { error: "Nome do template deve conter apenas letras minusculas, numeros e underscores (max 512 chars)" },
        { status: 400 }
      );
    }

    // Validate category
    if (!["MARKETING", "UTILITY"].includes(category)) {
      return NextResponse.json(
        { error: "Categoria deve ser MARKETING ou UTILITY" },
        { status: 400 }
      );
    }

    console.error(`[WA Templates] Creating template "${name}" (${category}) for WABA ${config.wabaId}`);

    // Create on Meta
    const metaResult = await createTemplateOnMeta(config, {
      name,
      language,
      category,
      components,
    });

    console.error(`[WA Templates] Meta returned: id=${metaResult.id}, status=${metaResult.status}`);

    // Store locally
    const admin = createAdminClient();
    const { data: template, error: insertError } = await admin
      .from("wa_templates")
      .insert({
        workspace_id: workspaceId,
        meta_id: metaResult.id,
        name,
        language,
        category: metaResult.category || category,
        status: metaResult.status || "PENDING",
        components,
        synced_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error("[WA Templates] DB insert error:", insertError.message);
      // Template was created on Meta but failed to save locally — not critical
    }

    return NextResponse.json({
      template: template || { name, status: metaResult.status, meta_id: metaResult.id },
      message: "Template enviado para revisao da Meta",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[WA Templates] Create error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE = delete a template from Meta + local DB
export async function DELETE(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const config = await getWaConfig(workspaceId);
    if (!config) {
      return NextResponse.json(
        { error: "WhatsApp nao configurado." },
        { status: 400 }
      );
    }

    const { name } = await request.json();
    if (!name) {
      return NextResponse.json({ error: "Nome do template e obrigatorio" }, { status: 400 });
    }

    console.error(`[WA Templates] Deleting template "${name}" for WABA ${config.wabaId}`);

    // Delete from Meta
    await deleteTemplateOnMeta(config, name);

    // Delete from local DB
    const admin = createAdminClient();
    await admin
      .from("wa_templates")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("name", name);

    console.error(`[WA Templates] Template "${name}" deleted successfully`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[WA Templates] Delete error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
