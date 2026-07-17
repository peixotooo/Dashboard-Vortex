import { NextRequest, NextResponse } from "next/server";
import {
  getWorkspaceAdminContext,
  getWorkspaceContext,
  handleAuthError,
} from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

interface StepInput {
  id?: string;
  step_order: number;
  delay_minutes: number;
  whatsapp_enabled: boolean;
  whatsapp_template_id: string | null;
  whatsapp_variable_mapping: Record<string, string>;
  email_enabled: boolean;
  email_subject: string | null;
  email_body_html: string | null;
  coupon_pct?: number;
  coupon_validity_hours?: number;
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();

    // Token do webhook VNDA (compartilhado com /orders) — mostrado no UI
    // pra usuário copiar e configurar no painel da VNDA.
    const { data: connection } = await admin
      .from("vnda_connections")
      .select("webhook_token")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const versionedRuleResult = await admin
      .from("cart_recovery_rules")
      .select(
        "id, workspace_id, enabled, expire_after_hours, current_version, intelligence_mode, rollout_percentage, holdout_percentage, free_shipping_threshold, free_shipping_thresholds"
      )
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const legacyRuleResult = versionedRuleResult.error
      ? await admin
          .from("cart_recovery_rules")
          .select("id, workspace_id, enabled, expire_after_hours")
          .eq("workspace_id", workspaceId)
          .maybeSingle()
      : null;
    const rule = versionedRuleResult.error
      ? legacyRuleResult?.data
      : versionedRuleResult.data;

    if (!rule) {
      return NextResponse.json({
        rule: null,
        steps: [],
        webhook_token: connection?.webhook_token || null,
      });
    }

    const stepColumns =
      "id, step_order, delay_minutes, whatsapp_enabled, whatsapp_template_id, whatsapp_variable_mapping, email_enabled, email_subject, email_body_html, coupon_pct, coupon_validity_hours";
    const activeStepsResult = await admin
      .from("cart_recovery_steps")
      .select(stepColumns)
      .eq("rule_id", rule.id)
      .eq("active", true)
      .order("step_order");

    // Compatibilidade durante a janela entre deploy e aplicação da migration
    // 137. Depois da migration, somente steps ativos são retornados.
    const legacyStepsResult = activeStepsResult.error
      ? await admin
          .from("cart_recovery_steps")
          .select(stepColumns)
          .eq("rule_id", rule.id)
          .order("step_order")
      : null;
    const steps = activeStepsResult.error
      ? legacyStepsResult?.data
      : activeStepsResult.data;

    return NextResponse.json({
      rule,
      steps: steps || [],
      webhook_token: connection?.webhook_token || null,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

// PUT: salva uma nova versão da rule e arquiva steps removidos atomicamente.
// Body: { enabled, expire_after_hours, steps: StepInput[] }
export async function PUT(request: NextRequest) {
  try {
    const { workspaceId, userId } = await getWorkspaceAdminContext(request);

    const body = (await request.json()) as {
      enabled: boolean;
      expire_after_hours: number;
      steps: StepInput[];
    };

    const stepRows = (body.steps || []).slice(0, 12).map((s, idx) => ({
      id: s.id || null,
      step_order: s.step_order ?? idx + 1,
      delay_minutes: Math.max(0, Number(s.delay_minutes) || 0),
      whatsapp_enabled: !!s.whatsapp_enabled,
      whatsapp_template_id: s.whatsapp_template_id || null,
      whatsapp_variable_mapping: s.whatsapp_variable_mapping || {},
      email_enabled: !!s.email_enabled,
      email_subject: s.email_subject || null,
      email_body_html: s.email_body_html || null,
      coupon_pct: Math.max(0, Math.min(100, Number(s.coupon_pct) || 0)),
      coupon_validity_hours: Math.max(
        1,
        Number(s.coupon_validity_hours) || 48
      ),
    }));

    const admin = createAdminClient();
    const { data: currentRule, error: currentRuleError } = await admin
      .from("cart_recovery_rules")
      .select("intelligence_mode")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (currentRuleError) throw currentRuleError;
    if (currentRule?.intelligence_mode === "pilot") {
      return NextResponse.json(
        {
          error:
            "Pause o piloto inteligente antes de alterar a régua. Isso preserva uma comparação confiável entre piloto e controle.",
        },
        { status: 409 }
      );
    }

    const { data, error } = await admin.rpc(
      "save_cart_recovery_rule_version",
      {
        p_workspace_id: workspaceId,
        p_enabled: !!body.enabled,
        p_expire_after_hours: Math.max(
          1,
          Number(body.expire_after_hours) || 168
        ),
        p_steps: stepRows,
        p_actor: userId,
      }
    );

    if (error) {
      const migrationMissing =
        error.message.includes("save_cart_recovery_rule_version") ||
        error.message.includes("schema cache");
      return NextResponse.json(
        {
          error: migrationMissing
            ? "A migration 137 precisa ser aplicada antes de salvar a régua versionada. Nenhum dado foi alterado."
            : error.message,
        },
        { status: migrationMissing ? 503 : 500 }
      );
    }

    const saved = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
      ok: true,
      rule_id: saved?.rule_id || null,
      version: saved?.version || null,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
