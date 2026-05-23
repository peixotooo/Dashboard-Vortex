import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { recheckTemplateOnMeta } from "@/lib/whatsapp-api";

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

// POST — re-checa o status do template UTILITY linkado na régua de
// recuperação direto na Meta API e atualiza o DB. Sem precisar ir em
// /crm/whatsapp e dar Sync nem recarregar a página.
//
// Body opcional: { template_id?: string }
//   - omitido → usa o template mais recente da régua (whatsapp_template_id
//     do primeiro step com whatsapp_enabled)
//   - fornecido → re-checa esse template específico
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
    let templateId: string | null = body.template_id || null;

    const admin = createAdminClient();

    // Se não veio template_id, pega o do primeiro step com WA enabled.
    if (!templateId) {
      const { data: rule } = await admin
        .from("cart_recovery_rules")
        .select("id")
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (rule) {
        const { data: step } = await admin
          .from("cart_recovery_steps")
          .select("whatsapp_template_id")
          .eq("rule_id", rule.id)
          .eq("whatsapp_enabled", true)
          .not("whatsapp_template_id", "is", null)
          .order("step_order")
          .limit(1)
          .maybeSingle();
        templateId = step?.whatsapp_template_id || null;
      }
    }

    if (!templateId) {
      return NextResponse.json(
        { error: "Nenhum template linkado na régua" },
        { status: 404 }
      );
    }

    const result = await recheckTemplateOnMeta(workspaceId, templateId);

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          reason: result.reason,
          message:
            result.reason === "no_wa_config"
              ? "WhatsApp não configurado pra esse workspace."
              : result.reason === "missing_meta_id"
              ? "Template não tem meta_id (pode ter sido criado fora do app)."
              : "Não foi possível consultar a Meta agora — tente em alguns segundos.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      changed: result.changed,
      status: result.currentStatus,
      category: result.currentCategory,
      previous_status: result.previousStatus,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
