import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { createTemplateOnMeta, getWaConfig } from "@/lib/whatsapp-api";
import {
  UTILITY_TEMPLATE_BODY,
  UTILITY_TEMPLATE_EXAMPLE_BODY_TEXT,
  DEFAULT_VARIABLE_MAPPING,
} from "@/lib/gift-request/recommended";

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

// POST — cria template UTILITY genérico ("{{1}}\n\n{{2}}") na Meta, persiste
// em wa_templates e (se apply_to_config=true, default) linka no
// gift_request_configs do workspace + aplica o mapping recomendado.
//
// Mesmo padrão do cart-recovery's create-utility-template (vide
// src/app/api/crm/cart-recovery/create-utility-template/route.ts) — Meta
// classifica como UTILITY (custo baixo), conteúdo "comercial" vai como
// variável de runtime.
export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId)
      return NextResponse.json(
        { error: "Workspace not specified" },
        { status: 400 }
      );

    const body = await request.json().catch(() => ({}));
    const applyToConfig = body.apply_to_config !== false;

    const config = await getWaConfig(workspaceId);
    if (!config) {
      return NextResponse.json(
        { error: "WhatsApp não configurado pra esse workspace." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    const ts = Math.floor(Date.now() / 1000);
    // Nome neutro/operacional — "gift_request" levava a Meta a classificar
    // como MARKETING. "share_message" é mais social/utility-friendly.
    const name = `bkng_share_message_v${ts}`;
    const language = "pt_BR";
    const category = "UTILITY";

    const components = [
      {
        type: "BODY",
        text: UTILITY_TEMPLATE_BODY,
        example: { body_text: UTILITY_TEMPLATE_EXAMPLE_BODY_TEXT },
      },
    ];

    let metaResult: { id: string; status?: string; category?: string };
    try {
      metaResult = await createTemplateOnMeta(config, {
        name,
        language,
        category,
        components,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(
        "[GiftRequest UtilityTemplate] Meta create failed:",
        message,
        "| sent:",
        JSON.stringify({ name, language, category, components })
      );
      return NextResponse.json(
        { error: `Meta recusou: ${message}` },
        { status: 502 }
      );
    }

    const { data: template, error: insertErr } = await admin
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
      .select("id, name, status, category")
      .single();

    if (insertErr || !template) {
      console.error(
        "[GiftRequest UtilityTemplate] DB insert error:",
        insertErr?.message
      );
      return NextResponse.json({
        ok: true,
        template: {
          name,
          status: metaResult.status,
          meta_id: metaResult.id,
        },
        warning:
          "Template criado na Meta, mas não persistiu localmente. Vá em /crm/whatsapp e clique em Sync.",
      });
    }

    if (applyToConfig) {
      await admin
        .from("gift_request_configs")
        .upsert(
          {
            workspace_id: workspaceId,
            wa_template_id: template.id,
            wa_variable_mapping: DEFAULT_VARIABLE_MAPPING,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id" }
        );
    }

    return NextResponse.json({
      ok: true,
      template,
      message:
        template.status === "APPROVED"
          ? "Template criado e aprovado pela Meta. Pode ativar o botão na PDP."
          : "Template enviado pra Meta. Aprovação costuma sair em minutos.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
