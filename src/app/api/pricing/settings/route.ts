// GET/PUT do pricing_engine_settings.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireAdmin } from "@/lib/pricing/supabase";
import { DEFAULT_ENGINE_SETTINGS } from "@/lib/pricing/types";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { data } = await auth.supabase
      .from("pricing_engine_settings")
      .select("*")
      .eq("workspace_id", auth.workspaceId)
      .maybeSingle();

    return NextResponse.json({
      settings: data ?? { workspace_id: auth.workspaceId, ...DEFAULT_ENGINE_SETTINGS },
      isDefault: !data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const payload = {
      workspace_id: auth.workspaceId,
      modo: body.modo ?? DEFAULT_ENGINE_SETTINGS.modo,
      cadencia: body.cadencia ?? DEFAULT_ENGINE_SETTINGS.cadencia,
      cadencia_dia_semana:
        body.cadencia_dia_semana ?? DEFAULT_ENGINE_SETTINGS.cadencia_dia_semana,
      cobertura_janela_dias:
        body.cobertura_janela_dias ?? DEFAULT_ENGINE_SETTINGS.cobertura_janela_dias,
      markdown_idade_min:
        body.markdown_idade_min ?? DEFAULT_ENGINE_SETTINGS.markdown_idade_min,
      markdown_cobertura_min:
        body.markdown_cobertura_min ?? DEFAULT_ENGINE_SETTINGS.markdown_cobertura_min,
      markdown_soma_min:
        body.markdown_soma_min ?? DEFAULT_ENGINE_SETTINGS.markdown_soma_min,
      markdown_desconto_inicial_pct:
        body.markdown_desconto_inicial_pct ??
        DEFAULT_ENGINE_SETTINGS.markdown_desconto_inicial_pct,
      markdown_incremento_pct:
        body.markdown_incremento_pct ?? DEFAULT_ENGINE_SETTINGS.markdown_incremento_pct,
      markup_idade_max:
        body.markup_idade_max ?? DEFAULT_ENGINE_SETTINGS.markup_idade_max,
      markup_cobertura_max:
        body.markup_cobertura_max ?? DEFAULT_ENGINE_SETTINGS.markup_cobertura_max,
      markup_margem_max_pct:
        body.markup_margem_max_pct ?? DEFAULT_ENGINE_SETTINGS.markup_margem_max_pct,
      markup_reducao_pct:
        body.markup_reducao_pct ?? DEFAULT_ENGINE_SETTINGS.markup_reducao_pct,
      trava_margem_minima_pct:
        body.trava_margem_minima_pct ?? DEFAULT_ENGINE_SETTINGS.trava_margem_minima_pct,
      trava_por_idade_enabled:
        body.trava_por_idade_enabled ?? DEFAULT_ENGINE_SETTINGS.trava_por_idade_enabled,
      trava_idade_1_30_pct:
        body.trava_idade_1_30_pct ?? DEFAULT_ENGINE_SETTINGS.trava_idade_1_30_pct,
      trava_idade_31_90_pct:
        body.trava_idade_31_90_pct ?? DEFAULT_ENGINE_SETTINGS.trava_idade_31_90_pct,
      trava_idade_91_120_pct:
        body.trava_idade_91_120_pct ?? DEFAULT_ENGINE_SETTINGS.trava_idade_91_120_pct,
      trava_idade_121_plus_pct:
        body.trava_idade_121_plus_pct ?? DEFAULT_ENGINE_SETTINGS.trava_idade_121_plus_pct,
      engine_excluded_tags: Array.isArray(body.engine_excluded_tags)
        ? body.engine_excluded_tags
        : DEFAULT_ENGINE_SETTINGS.engine_excluded_tags,
      combo_tag: body.combo_tag ?? DEFAULT_ENGINE_SETTINGS.combo_tag,
      combo_desconto_unitario_brl:
        body.combo_desconto_unitario_brl ??
        DEFAULT_ENGINE_SETTINGS.combo_desconto_unitario_brl,
      require_approval:
        body.require_approval ?? DEFAULT_ENGINE_SETTINGS.require_approval,
      enabled: body.enabled ?? DEFAULT_ENGINE_SETTINGS.enabled,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await auth.supabase
      .from("pricing_engine_settings")
      .upsert(payload, { onConflict: "workspace_id" })
      .select()
      .single();

    if (error) {
      console.error("[Pricing Settings] Upsert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ settings: data, isDefault: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
