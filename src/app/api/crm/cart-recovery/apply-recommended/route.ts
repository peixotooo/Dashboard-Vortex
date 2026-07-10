import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceAdminContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  RECOMMENDED_EXPIRE_AFTER_HOURS,
  RECOMMENDED_STEPS,
} from "@/lib/cart-recovery/recommended";

// POST — aplica a régua recomendada como uma nova versão. Steps anteriores
// são arquivados e o histórico de mensagens permanece intacto.
// Não ativa a régua automaticamente (enabled fica como estava) pra dar
// chance do usuário revisar antes de ligar.
//
// Retorna os steps criados pro UI re-renderizar imediatamente, junto
// com os whatsapp_suggested_body de cada step (que não vão pro DB mas
// são úteis pra mostrar como criar os templates na Meta).
export async function POST(request: NextRequest) {
  try {
    const { workspaceId, userId } = await getWorkspaceAdminContext(request);

    const admin = createAdminClient();

    // Upsert da régua. Se já existe, preserva enabled atual.
    const { data: existing } = await admin
      .from("cart_recovery_rules")
      .select("id, enabled")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    // Auto-detecta o template UTILITY mais recente criado pelo nosso
    // endpoint create-utility-template (nome começa com bkng_cart_recovery_).
    // Cobre o caso comum de o usuário clicar "Criar template UTILITY" ANTES
    // de aplicar a régua — sem isso o template ficaria órfão.
    const { data: latestUtility } = await admin
      .from("wa_templates")
      .select("id")
      .eq("workspace_id", workspaceId)
      .like("name", "bkng_cart_recovery_%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const autoTemplateId = latestUtility?.id || null;

    // Insere steps recomendados. Se houver template UTILITY auto-criado,
    // linka direto; senão, fica null e o usuário linka depois manualmente
    // ou clicando em "Criar template UTILITY automaticamente".
    const rows = RECOMMENDED_STEPS.map((s) => ({
      step_order: s.step_order,
      delay_minutes: s.delay_minutes,
      whatsapp_enabled: s.whatsapp_enabled,
      whatsapp_template_id: autoTemplateId,
      whatsapp_variable_mapping: s.whatsapp_variable_mapping,
      email_enabled: s.email_enabled,
      email_subject: s.email_subject,
      email_body_html: s.email_body_html,
      coupon_pct: s.coupon_pct,
      coupon_validity_hours: s.coupon_validity_hours,
    }));

    const { data: savedRows, error: saveError } = await admin.rpc(
      "save_cart_recovery_rule_version",
      {
        p_workspace_id: workspaceId,
        p_enabled: existing?.enabled ?? false,
        p_expire_after_hours: RECOMMENDED_EXPIRE_AFTER_HOURS,
        p_steps: rows,
        p_actor: userId,
      }
    );

    if (saveError) {
      const migrationMissing =
        saveError.message.includes("save_cart_recovery_rule_version") ||
        saveError.message.includes("schema cache");
      return NextResponse.json(
        {
          error: migrationMissing
            ? "A migration 137 precisa ser aplicada antes de versionar a régua. Nenhum step foi removido."
            : saveError.message,
        },
        { status: migrationMissing ? 503 : 500 }
      );
    }

    const saved = Array.isArray(savedRows) ? savedRows[0] : savedRows;

    return NextResponse.json({
      ok: true,
      rule_id: saved?.rule_id || null,
      version: saved?.version || null,
      expire_after_hours: RECOMMENDED_EXPIRE_AFTER_HOURS,
      auto_linked_template_id: autoTemplateId,
      whatsapp_suggested_bodies: RECOMMENDED_STEPS.map((s) => ({
        step_order: s.step_order,
        body: s.whatsapp_suggested_body,
      })),
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
