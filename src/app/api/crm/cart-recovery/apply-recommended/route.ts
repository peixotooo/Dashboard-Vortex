import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  RECOMMENDED_EXPIRE_AFTER_HOURS,
  RECOMMENDED_STEPS,
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

// POST — aplica a régua recomendada (substitui steps existentes).
// Não ativa a régua automaticamente (enabled fica como estava) pra dar
// chance do usuário revisar antes de ligar.
//
// Retorna os steps criados pro UI re-renderizar imediatamente, junto
// com os whatsapp_suggested_body de cada step (que não vão pro DB mas
// são úteis pra mostrar como criar os templates na Meta).
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

    const admin = createAdminClient();

    // Upsert da régua. Se já existe, preserva enabled atual.
    const { data: existing } = await admin
      .from("cart_recovery_rules")
      .select("id, enabled")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const { data: rule, error: ruleErr } = await admin
      .from("cart_recovery_rules")
      .upsert(
        {
          workspace_id: workspaceId,
          enabled: existing?.enabled ?? false,
          expire_after_hours: RECOMMENDED_EXPIRE_AFTER_HOURS,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id" }
      )
      .select("id")
      .single();

    if (ruleErr || !rule) {
      return NextResponse.json(
        { error: ruleErr?.message || "Failed to upsert rule" },
        { status: 500 }
      );
    }

    // Limpa steps existentes.
    await admin.from("cart_recovery_steps").delete().eq("rule_id", rule.id);

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
      workspace_id: workspaceId,
      rule_id: rule.id,
      step_order: s.step_order,
      delay_minutes: s.delay_minutes,
      whatsapp_enabled: s.whatsapp_enabled,
      whatsapp_template_id: autoTemplateId,
      whatsapp_variable_mapping: s.whatsapp_variable_mapping,
      email_enabled: s.email_enabled,
      email_subject: s.email_subject,
      email_body_html: s.email_body_html,
    }));

    const { error: stepsErr } = await admin
      .from("cart_recovery_steps")
      .insert(rows);

    if (stepsErr) {
      return NextResponse.json({ error: stepsErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      rule_id: rule.id,
      expire_after_hours: RECOMMENDED_EXPIRE_AFTER_HOURS,
      auto_linked_template_id: autoTemplateId,
      whatsapp_suggested_bodies: RECOMMENDED_STEPS.map((s) => ({
        step_order: s.step_order,
        body: s.whatsapp_suggested_body,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
