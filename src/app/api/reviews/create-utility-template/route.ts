import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { createTemplateOnMeta, getWaConfig } from "@/lib/whatsapp-api";

// Cria um template WhatsApp categoria UTILITY pra régua de avaliações e linka
// em review_settings.wa_template_id. Mesmo padrão de cart-recovery/gift-request:
// body genérico só com placeholders ({{1}} {{2}}) pra Meta classificar como
// UTILITY (~10x mais barato que MARKETING). O conteúdo real vai como variável
// no envio (saudação em {{1}}, mensagem + link em {{2}}).
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const config = await getWaConfig(workspaceId);
    if (!config) {
      return NextResponse.json(
        { error: "WhatsApp (Meta Cloud API) não configurado neste workspace. Configure em CRM → WhatsApp antes de criar o template." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const ts = Math.floor(Date.now() / 1000);
    const name = `bkng_review_prompt_v${ts}`; // neutro — evita Meta classificar como MARKETING
    const language = "pt_BR";
    const category = "UTILITY";
    // Mesmo padrão do template de carrinho abandonado (UTILITY-friendly): body
    // genérico com saudação + {{2}} carregando o conteúdo + link no runtime.
    const components = [
      {
        type: "BODY",
        text: "Olá {{1}}, tudo bem?\n\n{{2}}",
        example: {
          body_text: [[
            "João",
            "Sua compra na Bulking já chegou? Conta o que você achou: https://review.bulking.com.br/avaliar/exemplo",
          ]],
        },
      },
    ];

    let metaResult: { id: string; status?: string; category?: string };
    try {
      metaResult = await createTemplateOnMeta(config, { name, language, category, components });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[Reviews UtilityTemplate] Meta create failed:", message);
      return NextResponse.json({ error: `Meta recusou: ${message}` }, { status: 502 });
    }

    const { data: template } = await admin
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

    if (template) {
      await admin
        .from("review_settings")
        .upsert(
          { workspace_id: workspaceId, wa_template_id: template.id, updated_at: new Date().toISOString() },
          { onConflict: "workspace_id" }
        );
    }

    return NextResponse.json({
      ok: true,
      template: template || { name, status: metaResult.status, meta_id: metaResult.id },
      message:
        (template?.status || metaResult.status) === "APPROVED"
          ? "Template criado e aprovado pela Meta. A régua já dispara via template UTILITY."
          : "Template enviado pra Meta. A aprovação costuma sair em minutos; até lá a régua usa o WhatsApp legado (W-API).",
    });
  } catch (e) {
    return handleAuthError(e);
  }
}
