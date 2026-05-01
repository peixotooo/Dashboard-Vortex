// src/lib/email-templates/hero/prompts.ts
//
// Builds the GPT Image 2 prompt + reference image list for a (layout, slot,
// product) triple. Two URLs are passed in input_urls:
//   1) The visual style reference (one of public/hero-refs/*.jpg)
//   2) The actual product image (VNDA CDN), so the model knows what product
//      to feature.
//
// Style direction across all heroes (Bulking system):
//   - Monochrome (white, black, grayscale). NO saturated brand colors.
//   - Sans-serif typography, medium weight (500–600), never overly thin.
//   - Generous negative space, gradient or neutral background.
//   - Fitness-toned models when models are present (any gender).
//   - The Bulking product is always the centerpiece.

import type { LayoutId } from "../layouts/types";
import type { Slot, ProductSnapshot } from "../types";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "https://dash.bulking.com.br";

// Layout id → reference filename in public/hero-refs/
const LAYOUT_REF: Record<LayoutId, string> = {
  classic: "ref-8-puffer-detail.jpg",
  "editorial-overlay-light": "ref-1-black-friday.jpg",
  "numbered-grid-light": "ref-6-numbered-grid.jpg",
  "slash-labels-dark": "ref-9-asics-slash.jpg",
  "single-detail-dark": "ref-8-puffer-detail.jpg",
};

const SLOT_TEXT: Record<Slot, string> = {
  1: "TOP 1 DA SEMANA",
  2: "ÚLTIMA CHANCE",
  3: "NOVO DROP",
};

const SLOT_VIBE: Record<Slot, string> = {
  1: "premium product spotlight, calm confidence, the piece on display as a featured top-1 of the week",
  2: "subtle editorial urgency, last-units feel, restrained typography, no shouting and no neon colors",
  3: "fresh new-arrival energy, recently dropped, clean introduction of a new piece",
};

function refUrl(filename: string): string {
  return `${APP_BASE_URL}/hero-refs/${filename}`;
}

/**
 * VNDA's shelf_products.image_url is stored protocol-relative
 * (e.g. "//cdn.vnda.com.br/..."). External fetchers like kie.ai treat that
 * as a relative path and 404. Force https.
 */
function absUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return url; // leave unmodified for any other shape
}

export interface BuildPromptResult {
  prompt: string;
  input_urls: string[];
  reference_image: string;
  aspect_ratio: "3:4" | "4:3" | "1:1" | "9:16" | "16:9";
}

export function buildHeroPrompt(args: {
  layoutId: LayoutId;
  slot: Slot;
  product: ProductSnapshot;
}): BuildPromptResult {
  const { layoutId, slot, product } = args;
  const refFile = LAYOUT_REF[layoutId];
  const refImage = refUrl(refFile);
  const productImage = absUrl(product.image_url);
  const labelText = SLOT_TEXT[slot];
  const vibe = SLOT_VIBE[slot];

  // Composition guidance differs per layout, but the visual system stays the
  // same: monochrome, fitness-toned model when one is shown, generous space.
  const compositionByLayout: Record<LayoutId, string> = {
    classic:
      "vertical 3:4 editorial composition. The product is centered, full-bleed against a soft neutral gradient background.",
    "editorial-overlay-light":
      "vertical 3:4 composition with the product centered between two large words punched above and below in 84px sans-serif weight 500. The two words are TOP and SEMANA when slot is 1, ÚLTIMA and CHANCE when slot is 2, NOVO and DROP when slot is 3. The product image is centered between the words. Light gradient background.",
    "numbered-grid-light":
      "vertical 3:4 composition: a single fitness model wearing the product, full body, centered, hands at sides, neutral pose. Pale cream paper-textured background. Optional small cursive number '1.' top-right corner.",
    "slash-labels-dark":
      "vertical 3:4 dark editorial composition. Fitness model wearing the product, full body, dramatic side lighting, deep black gradient background. Small slash-separated meta labels in white sans-serif weight 500 floating top-left and bottom-right of the frame.",
    "single-detail-dark":
      "vertical 3:4 dark moody portrait. Fitness model wearing the product, three-quarter view, soft directional rim light, gradient charcoal-to-black background. Shallow depth of field. Editorial, premium streetwear feel.",
  };

  const composition = compositionByLayout[layoutId];

  const prompt = [
    `Generate a premium fashion email hero image for the streetwear/fitness brand BULKING.`,
    `Use the FIRST input image as the visual style reference (composition, palette, type weight, mood).`,
    `Use the SECOND input image as the product to feature: "${product.name}". The product must be the visual centerpiece, faithfully reproduced (same colorway, same garment shape, same details).`,
    "",
    `Composition: ${composition}`,
    `Mood: ${vibe}.`,
    "",
    `Typography on the image: render the text "${labelText}" in clean sans-serif at medium weight (500–600), monochrome, generous letter-spacing 0.2em–0.3em, all caps. Spell the text exactly, no decorative flourishes.`,
    `Also render the small product caption "${product.name.toUpperCase()}" in sans-serif weight 500, monochrome, letter-spacing 0.1em.`,
    "",
    `Models (if any): athletic fitness body type, neutral expression, focused. Any gender. Always confident posture. No exaggerated facial expressions.`,
    "",
    `Color system: white, black, grays only. No saturated brand color anywhere on the image. Background is a soft neutral gradient (white-to-grey for light layouts, charcoal-to-black for dark layouts).`,
    `Negative space: generous. Avoid cluttered backgrounds, no busy graphic elements.`,
    `Quality: editorial, magazine cover level. Sharp product reproduction. No text artifacts, no warped letters.`,
  ].join("\n");

  // Both references are passed; reference first, product second.
  return {
    prompt,
    input_urls: [refImage, productImage],
    reference_image: refFile,
    aspect_ratio: "3:4",
  };
}
