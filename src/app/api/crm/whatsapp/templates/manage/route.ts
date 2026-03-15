import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getWaConfig,
  createTemplateOnMeta,
  deleteTemplateOnMeta,
  type WaConfig,
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

// --- Meta resumable upload for header_handle ---

async function getAppId(accessToken: string): Promise<string> {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/debug_token?input_token=${accessToken}&access_token=${accessToken}`
  );
  if (!res.ok) throw new Error("Nao foi possivel obter APP_ID do token");
  const data = await res.json();
  const appId = data.data?.app_id;
  if (!appId) throw new Error("APP_ID nao encontrado no token");
  return appId;
}

async function uploadMediaToMeta(
  accessToken: string,
  fileBuffer: Buffer,
  mimeType: string
): Promise<string> {
  const appId = await getAppId(accessToken);

  // 1. Create upload session
  const sessionRes = await fetch(
    `https://graph.facebook.com/v21.0/${appId}/uploads?file_length=${fileBuffer.length}&file_type=${encodeURIComponent(mimeType)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!sessionRes.ok) {
    const text = await sessionRes.text().catch(() => "");
    throw new Error(`Meta upload session error ${sessionRes.status}: ${text.slice(0, 200)}`);
  }
  const session = await sessionRes.json();
  const uploadSessionId = session.id;
  if (!uploadSessionId) throw new Error("Upload session ID nao retornado pela Meta");

  console.error(`[WA Templates] Upload session created: ${uploadSessionId}`);

  // 2. Upload file binary
  const uploadRes = await fetch(
    `https://graph.facebook.com/v21.0/${uploadSessionId}`,
    {
      method: "POST",
      headers: {
        Authorization: `OAuth ${accessToken}`,
        file_offset: "0",
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(fileBuffer),
    }
  );
  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    throw new Error(`Meta upload error ${uploadRes.status}: ${text.slice(0, 200)}`);
  }
  const uploadResult = await uploadRes.json();
  const handle = uploadResult.h;
  if (!handle) throw new Error("header_handle nao retornado pela Meta");

  console.error(`[WA Templates] Media uploaded, handle: ${handle.slice(0, 30)}...`);
  return handle;
}

// Convert header_url to header_handle by uploading media to Meta
async function convertHeaderUrlToHandle(
  config: WaConfig,
  components: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const result = [];
  for (const comp of components) {
    const example = comp.example as Record<string, unknown> | undefined;
    const headerUrls = example?.header_url as string[] | undefined;

    if (comp.type === "HEADER" && headerUrls?.length) {
      const mediaUrl = headerUrls[0];
      console.error(`[WA Templates] Downloading media from: ${mediaUrl.slice(0, 80)}...`);

      // Download from B2
      const fileRes = await fetch(mediaUrl);
      if (!fileRes.ok) throw new Error(`Erro ao baixar midia: HTTP ${fileRes.status}`);
      const buffer = Buffer.from(await fileRes.arrayBuffer());
      const mimeType = fileRes.headers.get("content-type") || "image/jpeg";

      // Upload to Meta
      const handle = await uploadMediaToMeta(config.accessToken, buffer, mimeType);

      // Replace header_url with header_handle
      result.push({
        ...comp,
        example: { header_handle: [handle] },
      });
    } else {
      result.push(comp);
    }
  }
  return result;
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

    if (!name || !language || !category || !components) {
      return NextResponse.json(
        { error: "Campos obrigatorios: name, language, category, components" },
        { status: 400 }
      );
    }

    if (!/^[a-z0-9_]+$/.test(name) || name.length > 512) {
      return NextResponse.json(
        { error: "Nome do template deve conter apenas letras minusculas, numeros e underscores (max 512 chars)" },
        { status: 400 }
      );
    }

    if (!["MARKETING", "UTILITY"].includes(category)) {
      return NextResponse.json(
        { error: "Categoria deve ser MARKETING ou UTILITY" },
        { status: 400 }
      );
    }

    console.error(`[WA Templates] Creating template "${name}" (${category}) for WABA ${config.wabaId}`);

    // Convert any header_url to header_handle by uploading media to Meta
    const processedComponents = await convertHeaderUrlToHandle(config, components);

    // Create on Meta
    const metaResult = await createTemplateOnMeta(config, {
      name,
      language,
      category,
      components: processedComponents,
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

    await deleteTemplateOnMeta(config, name);

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
