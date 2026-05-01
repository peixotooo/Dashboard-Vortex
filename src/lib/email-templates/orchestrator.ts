// src/lib/email-templates/orchestrator.ts
import { createAdminClient } from "@/lib/supabase-admin";
import { logAudit } from "./audit";
import { getSettings } from "./settings";
import { resolveSegmentForSlot } from "./segments";
import { pickTopHours } from "./hours";
import { pickBestseller, pickNewarrival, pickRelatedProducts, pickSlowmoving } from "./picker";
import { generateCopy } from "./copy";
import { createSlowmovingCoupon } from "./coupon";
import { buildCountdownUrl } from "./countdown";
import { pickLayout } from "./layouts";
import type { Slot, ProductSnapshot, EmailTemplateSettings, TemplateRenderContext } from "./types";

interface SlotResult {
  slot: Slot;
  ok: boolean;
  reason?: string;
  suggestion_id?: string;
}

const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "https://app.bulking.com.br";

function todayBrt(): string {
  const now = new Date();
  // BRT = UTC-3 (Brazil does not observe DST since 2019)
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return brt.toISOString().slice(0, 10);
}

async function generateSlotBestseller(
  workspace_id: string,
  settings: EmailTemplateSettings,
  date: string,
  hours: { recommended_hours: number[]; hours_score: Record<string, number> },
  exclude_ids: Set<string>
): Promise<SlotResult> {
  const pick = await pickBestseller(workspace_id, settings, exclude_ids);
  if (!pick.product) {
    await logAudit({ workspace_id, event: "skipped_no_product", payload: { slot: 1, reason: pick.reason } });
    return { slot: 1, ok: false, reason: pick.reason };
  }
  const related = await pickRelatedProducts(
    workspace_id,
    new Set([pick.product.vnda_id, ...exclude_ids]),
    3
  );
  return persistSuggestion({
    workspace_id, settings, date, slot: 1, product: pick.product, hours,
    related_products: related,
    hook: "O top 1 da semana",
    render: (ctx) => pickLayout({ workspace_id, date, slot: 1 }).render(ctx),
  });
}

async function generateSlotSlowmoving(
  workspace_id: string,
  settings: EmailTemplateSettings,
  date: string,
  hours: { recommended_hours: number[]; hours_score: Record<string, number> },
  exclude_ids: Set<string>
): Promise<SlotResult> {
  const pick = await pickSlowmoving(workspace_id, settings, exclude_ids);
  if (!pick.product) {
    await logAudit({ workspace_id, event: "skipped_no_product", payload: { slot: 2, reason: pick.reason } });
    return { slot: 2, ok: false, reason: pick.reason };
  }

  let coupon;
  try {
    coupon = await createSlowmovingCoupon({
      workspace_id,
      product: pick.product,
      discount_percent: settings.slowmoving_discount_percent,
      validity_hours: settings.slowmoving_coupon_validity_hours,
    });
    await logAudit({ workspace_id, event: "coupon_created", payload: { code: coupon.code, slot: 2 } });
  } catch (err) {
    await logAudit({
      workspace_id,
      event: "coupon_failed",
      payload: { slot: 2, error: String((err as Error).message) },
    });
    return { slot: 2, ok: false, reason: "coupon_failed" };
  }

  const countdown_url = buildCountdownUrl({
    base_url: APP_BASE_URL,
    expires_at: coupon.expires_at,
  });

  const related = await pickRelatedProducts(
    workspace_id,
    new Set([pick.product.vnda_id, ...exclude_ids]),
    3
  );
  return persistSuggestion({
    workspace_id, settings, date, slot: 2, product: pick.product, hours,
    coupon: { ...coupon, countdown_url },
    related_products: related,
    hook: "Estoque acabando",
    render: (ctx) => pickLayout({ workspace_id, date, slot: 2 }).render(ctx),
  });
}

async function generateSlotNewarrival(
  workspace_id: string,
  settings: EmailTemplateSettings,
  date: string,
  hours: { recommended_hours: number[]; hours_score: Record<string, number> },
  exclude_ids: Set<string>
): Promise<SlotResult> {
  const pick = await pickNewarrival(workspace_id, settings, exclude_ids);
  if (!pick.product) {
    await logAudit({ workspace_id, event: "skipped_no_product", payload: { slot: 3, reason: pick.reason } });
    return { slot: 3, ok: false, reason: pick.reason };
  }
  const related = await pickRelatedProducts(
    workspace_id,
    new Set([pick.product.vnda_id, ...exclude_ids]),
    3
  );
  return persistSuggestion({
    workspace_id, settings, date, slot: 3, product: pick.product, hours,
    related_products: related,
    hook: "Acabou de chegar",
    render: (ctx) => pickLayout({ workspace_id, date, slot: 3 }).render(ctx),
  });
}

async function persistSuggestion(args: {
  workspace_id: string;
  settings: EmailTemplateSettings;
  date: string;
  slot: Slot;
  product: ProductSnapshot;
  hours: { recommended_hours: number[]; hours_score: Record<string, number> };
  coupon?: {
    code: string;
    vnda_promotion_id: number;
    vnda_coupon_id: number;
    expires_at: Date;
    discount_percent: number;
    countdown_url: string;
  };
  render: (ctx: TemplateRenderContext) => string;
  related_products?: ProductSnapshot[];
  hook?: string;
}): Promise<SlotResult> {
  const { workspace_id, settings, date, slot, product, hours, coupon, render, related_products, hook } = args;
  const segment = await resolveSegmentForSlot(workspace_id, slot);

  const { output: copy, provider_used } = await generateCopy(
    {
      slot,
      product,
      segment,
      coupon: coupon
        ? { code: coupon.code, discount_percent: coupon.discount_percent, expires_at: coupon.expires_at }
        : undefined,
      workspace_id,
    },
    settings.copy_provider,
    settings.llm_agent_slug
  );

  let rendered_html: string;
  try {
    rendered_html = render({
      slot,
      product,
      related_products: related_products ?? [],
      copy,
      coupon: coupon
        ? {
            code: coupon.code,
            discount_percent: coupon.discount_percent,
            expires_at: coupon.expires_at,
            countdown_url: coupon.countdown_url,
          }
        : undefined,
      workspace: { name: "Bulking" },
      hook,
    });
  } catch (err) {
    const msg = String((err as Error).message);
    console.error(`[email-templates/orchestrator] slot ${slot} render_failed:`, msg, (err as Error).stack);
    await logAudit({
      workspace_id,
      event: "render_failed",
      payload: { slot, error: msg },
    });
    return { slot, ok: false, reason: "render_failed" };
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("email_template_suggestions")
    .upsert(
      {
        workspace_id,
        generated_for_date: date,
        slot,
        vnda_product_id: product.vnda_id,
        product_snapshot: product,
        target_segment_type: segment.type,
        target_segment_payload: { ...segment.payload, estimated_size: segment.estimated_size, display_label: segment.display_label },
        copy,
        copy_provider: provider_used,
        rendered_html,
        recommended_hours: hours.recommended_hours,
        hours_score: hours.hours_score,
        coupon_code: coupon?.code ?? null,
        coupon_vnda_promotion_id: coupon?.vnda_promotion_id ?? null,
        coupon_vnda_coupon_id: coupon?.vnda_coupon_id ?? null,
        coupon_expires_at: coupon?.expires_at?.toISOString() ?? null,
        coupon_discount_percent: coupon?.discount_percent ?? null,
        status: "pending",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,generated_for_date,slot" }
    )
    .select("id")
    .single();

  if (error) {
    console.error(`[email-templates/orchestrator] slot ${slot} db upsert failed:`, error.message);
    await logAudit({ workspace_id, event: "render_failed", payload: { slot, db_error: error.message } });
    return { slot, ok: false, reason: "db_error" };
  }

  await logAudit({
    workspace_id,
    suggestion_id: data.id as string,
    event: "generated",
    payload: { slot, copy_provider: provider_used, has_coupon: !!coupon },
  });
  return { slot, ok: true, suggestion_id: data.id as string };
}

export async function generateForWorkspace(workspace_id: string): Promise<{
  workspace_id: string;
  date: string;
  results: SlotResult[];
}> {
  const settings = await getSettings(workspace_id);
  if (!settings.enabled) {
    return { workspace_id, date: todayBrt(), results: [] };
  }
  const date = todayBrt();
  const hours = await pickTopHours(workspace_id, 14);

  // Sequential to enforce cross-slot product dedup: a product chosen for slot 1
  // is excluded from slots 2 and 3 today; slot-2's product is excluded from slot 3.
  const usedIdsToday = new Set<string>();
  const results: SlotResult[] = [];

  const r1 = await generateSlotBestseller(workspace_id, settings, date, hours, usedIdsToday);
  results.push(r1);
  if (r1.ok && r1.suggestion_id) {
    const id = await getSuggestionProductId(r1.suggestion_id);
    if (id) usedIdsToday.add(id);
  }

  const r2 = await generateSlotSlowmoving(workspace_id, settings, date, hours, usedIdsToday);
  results.push(r2);
  if (r2.ok && r2.suggestion_id) {
    const id = await getSuggestionProductId(r2.suggestion_id);
    if (id) usedIdsToday.add(id);
  }

  const r3 = await generateSlotNewarrival(workspace_id, settings, date, hours, usedIdsToday);
  results.push(r3);

  return { workspace_id, date, results };
}

async function getSuggestionProductId(suggestion_id: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("email_template_suggestions")
    .select("vnda_product_id")
    .eq("id", suggestion_id)
    .maybeSingle();
  return (data?.vnda_product_id as string) ?? null;
}
