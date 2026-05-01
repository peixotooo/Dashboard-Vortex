// src/lib/email-templates/hero/generate.ts
//
// One call site for "give me a hero URL for this (workspace, product, layout,
// slot)". Returns null when generation is disabled (no KIE_API_KEY) or when
// the kie.ai pipeline fails — callers fall back to product.image_url.

import { generateImage } from "./client";
import { buildHeroPrompt } from "./prompts";
import { persistGeneratedHero } from "./storage";
import { getHero, saveHero } from "./cache";
import type { LayoutId } from "../layouts/types";
import type { Slot, ProductSnapshot } from "../types";

export async function ensureHero(args: {
  workspace_id: string;
  layout_id: LayoutId;
  slot: Slot;
  product: ProductSnapshot;
}): Promise<string | null> {
  // Cache hit short-circuit.
  const cached = await getHero({
    workspace_id: args.workspace_id,
    vnda_product_id: args.product.vnda_id,
    layout_id: args.layout_id,
    slot: args.slot,
  });
  if (cached) return cached.hero_url;

  if (!process.env.KIE_API_KEY) {
    return null;
  }

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
    console.error("[email-templates/hero] generation failed:", (err as Error).message);
    return null;
  }

  const sourceUrl = kieResult.urls[0];
  if (!sourceUrl) return null;

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
    console.error("[email-templates/hero] B2 persist failed:", (err as Error).message);
    return null;
  }

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
