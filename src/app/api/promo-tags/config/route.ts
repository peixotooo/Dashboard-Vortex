import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  hydratePromoTagRuleModal,
  withPromoTagModalMetadata,
} from "@/lib/promo-tags/modal-metadata";
import {
  extractPromoTagComboTiers,
  normalizePromoTagComboTiers,
  withPromoTagComboTiersMetadata,
} from "@/lib/promo-tags/combo-tiers";

function isMissingModalColumn(message: string): boolean {
  return (
    message.includes("modal_title") ||
    message.includes("modal_body") ||
    message.includes("schema cache")
  );
}

function isMissingOptionalColumn(message: string): boolean {
  return isMissingModalColumn(message) || message.includes("combo_tiers");
}

function withOptionalPromoTagMetadata(
  showOnPages: unknown,
  modalTitle: unknown,
  modalBody: unknown,
  comboTiers: unknown
): string[] {
  return withPromoTagComboTiersMetadata(
    withPromoTagModalMetadata(showOnPages, modalTitle, modalBody),
    comboTiers
  );
}

function hydratePromoTagRule<T extends Record<string, unknown>>(rule: T) {
  const modalRule = hydratePromoTagRuleModal(rule);
  return {
    ...modalRule,
    combo_tiers: extractPromoTagComboTiers(rule),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const admin = createAdminClient();

    const { data: rules, error } = await admin
      .from("promo_tag_configs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("priority", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      rules: (rules || []).map((rule) => hydratePromoTagRule(rule)),
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const body = await request.json();

    if (!body.name || !body.match_type || !body.match_value || !body.badge_text) {
      return NextResponse.json(
        { error: "name, match_type, match_value, and badge_text are required" },
        { status: 400 }
      );
    }

    const insertPayload: Record<string, unknown> = {
      workspace_id: workspaceId,
      enabled: body.enabled ?? true,
      name: body.name,
      priority: body.priority ?? 0,
      match_type: body.match_type,
      match_value: body.match_value,
      badge_text: body.badge_text,
      badge_bg_color: body.badge_bg_color || "#ff0000",
      badge_text_color: body.badge_text_color || "#ffffff",
      badge_font_size: body.badge_font_size || "11px",
      badge_border_radius: body.badge_border_radius || "4px",
      badge_position: body.badge_position || "top-left",
      badge_padding: body.badge_padding || "4px 8px",
      show_on_pages: body.show_on_pages || ["all"],
      badge_type: body.badge_type || "static",
      badge_placement: body.badge_placement || "auto",
      viewers_min: body.viewers_min ?? 3,
      viewers_max: body.viewers_max ?? 56,
      starts_at: body.starts_at || null,
      ends_at: body.ends_at || null,
      combo_tiers: normalizePromoTagComboTiers(body.combo_tiers),
    };

    if (body.modal_title) insertPayload.modal_title = body.modal_title;
    if (body.modal_body) insertPayload.modal_body = body.modal_body;

    const admin = createAdminClient();
    let result = await admin
      .from("promo_tag_configs")
      .insert(insertPayload)
      .select()
      .single();

    if (result.error && isMissingOptionalColumn(result.error.message)) {
      delete insertPayload.modal_title;
      delete insertPayload.modal_body;
      delete insertPayload.combo_tiers;
      insertPayload.show_on_pages = withOptionalPromoTagMetadata(
        body.show_on_pages || ["all"],
        body.modal_title,
        body.modal_body,
        body.combo_tiers
      );
      result = await admin
        .from("promo_tag_configs")
        .insert(insertPayload)
        .select()
        .single();
    }

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    return NextResponse.json({ rule: hydratePromoTagRule(result.data) });
  } catch (error) {
    return handleAuthError(error);
  }
}
