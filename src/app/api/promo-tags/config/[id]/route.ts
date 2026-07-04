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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { id } = await params;
    const body = await request.json();

    const updatePayload: Record<string, unknown> = {
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      ...(body.name && { name: body.name }),
      ...(body.priority !== undefined && { priority: body.priority }),
      ...(body.match_type && { match_type: body.match_type }),
      ...(body.match_value && { match_value: body.match_value }),
      ...(body.badge_text && { badge_text: body.badge_text }),
      ...(body.badge_bg_color && { badge_bg_color: body.badge_bg_color }),
      ...(body.badge_text_color && { badge_text_color: body.badge_text_color }),
      ...(body.badge_font_size && { badge_font_size: body.badge_font_size }),
      ...(body.badge_border_radius && {
        badge_border_radius: body.badge_border_radius,
      }),
      ...(body.badge_position && { badge_position: body.badge_position }),
      ...(body.badge_padding && { badge_padding: body.badge_padding }),
      ...(body.show_on_pages && { show_on_pages: body.show_on_pages }),
      ...(body.badge_type && { badge_type: body.badge_type }),
      ...(body.badge_placement && { badge_placement: body.badge_placement }),
      ...(body.viewers_min !== undefined && { viewers_min: body.viewers_min }),
      ...(body.viewers_max !== undefined && { viewers_max: body.viewers_max }),
      ...(body.starts_at !== undefined && { starts_at: body.starts_at || null }),
      ...(body.ends_at !== undefined && { ends_at: body.ends_at || null }),
      ...(body.modal_title !== undefined && { modal_title: body.modal_title || null }),
      ...(body.modal_body !== undefined && { modal_body: body.modal_body || null }),
      ...(body.combo_tiers !== undefined && {
        combo_tiers: normalizePromoTagComboTiers(body.combo_tiers),
      }),
    };

    const admin = createAdminClient();
    let result = await admin
      .from("promo_tag_configs")
      .update(updatePayload)
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (result.error && isMissingOptionalColumn(result.error.message)) {
      delete updatePayload.modal_title;
      delete updatePayload.modal_body;
      delete updatePayload.combo_tiers;
      if (
        body.modal_title !== undefined ||
        body.modal_body !== undefined ||
        body.combo_tiers !== undefined
      ) {
        updatePayload.show_on_pages = withOptionalPromoTagMetadata(
          body.show_on_pages || updatePayload.show_on_pages || ["all"],
          body.modal_title,
          body.modal_body,
          body.combo_tiers
        );
      }
      result = await admin
        .from("promo_tag_configs")
        .update(updatePayload)
        .eq("id", id)
        .eq("workspace_id", workspaceId)
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { id } = await params;

    const admin = createAdminClient();
    const { error } = await admin
      .from("promo_tag_configs")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAuthError(error);
  }
}
