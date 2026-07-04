import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

interface StepInput {
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

    const { data: rule } = await admin
      .from("cart_recovery_rules")
      .select("id, workspace_id, enabled, expire_after_hours")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!rule) {
      return NextResponse.json({
        rule: null,
        steps: [],
        webhook_token: connection?.webhook_token || null,
      });
    }

    const { data: steps } = await admin
      .from("cart_recovery_steps")
      .select(
        "id, step_order, delay_minutes, whatsapp_enabled, whatsapp_template_id, whatsapp_variable_mapping, email_enabled, email_subject, email_body_html, coupon_pct, coupon_validity_hours"
      )
      .eq("rule_id", rule.id)
      .order("step_order");

    return NextResponse.json({
      rule,
      steps: steps || [],
      webhook_token: connection?.webhook_token || null,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

// PUT: substitui rule + todos os steps atomicamente.
// Body: { enabled, expire_after_hours, steps: StepInput[] }
export async function PUT(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const body = (await request.json()) as {
      enabled: boolean;
      expire_after_hours: number;
      steps: StepInput[];
    };

    const admin = createAdminClient();

    // Upsert da régua (1 por workspace).
    const { data: rule, error: ruleErr } = await admin
      .from("cart_recovery_rules")
      .upsert(
        {
          workspace_id: workspaceId,
          enabled: !!body.enabled,
          expire_after_hours: Math.max(1, Number(body.expire_after_hours) || 168),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id" }
      )
      .select("id")
      .single();

    if (ruleErr || !rule) {
      return NextResponse.json(
        { error: ruleErr?.message || "Failed to save rule" },
        { status: 500 }
      );
    }

    // Replace steps: deleta todos e reinsere. Mensagens já enviadas
    // (cart_recovery_messages) têm FK em step_id ON DELETE CASCADE —
    // o histórico de mensagens daquele step será perdido. Aceitável
    // pois o usuário editou conscientemente. Carts em vôo continuarão
    // recebendo conforme os novos steps.
    await admin
      .from("cart_recovery_steps")
      .delete()
      .eq("rule_id", rule.id);

    const stepRows = (body.steps || []).map((s, idx) => ({
      workspace_id: workspaceId,
      rule_id: rule.id,
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

    if (stepRows.length > 0) {
      const { error: stepsErr } = await admin
        .from("cart_recovery_steps")
        .insert(stepRows);
      if (stepsErr) {
        return NextResponse.json(
          { error: stepsErr.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ ok: true, rule_id: rule.id });
  } catch (error) {
    return handleAuthError(error);
  }
}
