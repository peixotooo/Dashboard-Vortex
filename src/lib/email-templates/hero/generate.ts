// src/lib/email-templates/hero/generate.ts
//
// One call site for "give me a hero URL for this (workspace, product, layout,
// slot)". Returns null when generation is disabled (no KIE_API_KEY) or when
// the kie.ai pipeline fails — callers fall back to product.image_url.

import { generateImage } from "./client";
import { buildHeroPrompt } from "./prompts";
import { persistGeneratedHero } from "./storage";
import { getHero, saveHero } from "./cache";
import { logAudit } from "../audit";
import type { LayoutId } from "../layouts/types";
import type { Slot, ProductSnapshot } from "../types";

async function audit(workspace_id: string, payload: Record<string, unknown>) {
  try {
    await logAudit({ workspace_id, event: "generated", payload: { hero_diag: payload } });
  } catch {
    // best-effort
  }
}

export async function ensureHero(args: {
  workspace_id: string;
  layout_id: LayoutId;
  slot: Slot;
  product: ProductSnapshot;
}): Promise<string | null> {
  await audit(args.workspace_id, {
    step: "start",
    slot: args.slot,
    layout: args.layout_id,
    product: args.product.vnda_id,
    kieKey: !!process.env.KIE_API_KEY,
  });

  const cached = await getHero({
    workspace_id: args.workspace_id,
    vnda_product_id: args.product.vnda_id,
    layout_id: args.layout_id,
    slot: args.slot,
  });
  if (cached) {
    await audit(args.workspace_id, { step: "cache_hit", slot: args.slot });
    return cached.hero_url;
  }

  if (!process.env.KIE_API_KEY) {
    await audit(args.workspace_id, { step: "kie_missing", slot: args.slot });
    return null;
  }
  await audit(args.workspace_id, { step: "kie_call", slot: args.slot });

  // Build prompt + reference list.
  const built = buildHeroPrompt({
    layoutId: args.layout_id,
    slot: args.slot,
    product: args.product,
  });

  let kieResult: { taskId: string; urls: string[] };
  try {
    kieResult = await generateImage(
      {
        prompt: built.prompt,
        input_urls: built.input_urls,
        aspect_ratio: built.aspect_ratio,
        resolution: "1K",
      },
      { pollIntervalMs: 4_000, timeoutMs: 150_000 }
    );
  } catch (err) {
    await audit(args.workspace_id, {
      step: "kie_failed",
      slot: args.slot,
      error: String((err as Error).message).slice(0, 240),
    });
    return null;
  }

  const sourceUrl = kieResult.urls[0];
  if (!sourceUrl) {
    await audit(args.workspace_id, { step: "no_source_url", slot: args.slot });
    return null;
  }

  let permanentUrl: string;
  try {
    permanentUrl = await persistGeneratedHero({
      workspace_id: args.workspace_id,
      vnda_product_id: args.product.vnda_id,
      layout_id: args.layout_id,
      slot: args.slot,
      source_url: sourceUrl,
    });
  } catch (err) {
    await audit(args.workspace_id, {
      step: "b2_failed",
      slot: args.slot,
      error: String((err as Error).message).slice(0, 240),
    });
    return null;
  }
  await audit(args.workspace_id, { step: "b2_ok", slot: args.slot, url: permanentUrl });

  await saveHero({
    workspace_id: args.workspace_id,
    vnda_product_id: args.product.vnda_id,
    layout_id: args.layout_id,
    slot: args.slot,
    hero_url: permanentUrl,
    reference_image: built.reference_image,
    prompt: built.prompt,
    kie_task_id: kieResult.taskId,
    source_image_urls: built.input_urls,
    created_at: new Date().toISOString(),
  });

  return permanentUrl;
}
