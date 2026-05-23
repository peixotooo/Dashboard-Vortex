import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { createTemplateOnMeta, getWaConfig } from "@/lib/whatsapp-api";
import {
  UTILITY_TEMPLATE_BODY,
  UTILITY_TEMPLATE_EXAMPLE_BODY_TEXT,
} from "@/lib/cart-recovery/recommended";

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

// POST — cria 1 template UTILITY genérico ("{{1}}\n\n{{2}}") na Meta,
// armazena em wa_templates, e linka todos os steps de WhatsApp da régua
// atual nesse template.
//
// Por que template UTILITY genérico:
// - Templates UTILITY custam ~10x menos que MARKETING (cobrança Meta).
// - Pra Meta aprovar como UTILITY, o body do template não pode parecer
//   comercial. Body só com placeholders ({{1}} {{2}}) é universal e a
//   Meta classifica como UTILITY na maioria das categorias.
// - O conteúdo "comercial" (oi João, escassez, etc) vai como variável de
//   runtime no mapping (resolveMappingValue interpola text:).
//
// Body do request: { apply_to_steps?: boolean } (default true)
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
    const applyToSteps = body.apply_to_steps !== false;

    const config = await getWaConfig(workspaceId);
    if (!config) {
      return NextResponse.json(
        { error: "WhatsApp não configurado pra esse workspace." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Nome único — timestamp evita conflito em recriações. Lower-case
    // + underscores (regra Meta).
    const ts = Math.floor(Date.now() / 1000);
    const name = `bkng_cart_recovery_v${ts}`;
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
      // Loga o body enviado pra debug — Meta às vezes retorna mensagens
      // genéricas tipo "Invalid parameter" e a única forma de descobrir
      // o que rejeitou é olhar exatamente o que mandamos.
      console.error(
        "[CartRecovery UtilityTemplate] Meta create failed:",
        message,
        "| sent:",
        JSON.stringify({ name, language, category, components })
      );
      return NextResponse.json(
        { error: `Meta recusou: ${message}` },
        { status: 502 }
      );
    }

    // Persiste em wa_templates.
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
        "[CartRecovery UtilityTemplate] DB insert error:",
        insertErr?.message
      );
      // Template foi criado na Meta com sucesso, então não retorna erro
      // total — só avisa o user pra resyncar templates.
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

    // Linka todos os steps de WA da régua atual nesse template.
    if (applyToSteps) {
      const { data: rule } = await admin
        .from("cart_recovery_rules")
        .select("id")
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (rule) {
        await admin
          .from("cart_recovery_steps")
          .update({ whatsapp_template_id: template.id })
          .eq("rule_id", rule.id)
          .eq("whatsapp_enabled", true);
      }
    }

    return NextResponse.json({
      ok: true,
      template,
      message:
        template.status === "APPROVED"
          ? "Template criado e aprovado pela Meta. A régua já pode disparar."
          : "Template enviado pra Meta. Aprovação costuma sair em minutos. Quando aprovar, a régua começa a disparar automaticamente.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
