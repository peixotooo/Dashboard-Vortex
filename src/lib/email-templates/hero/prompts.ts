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

/**
 * Lower-body items frequently trigger OpenAI's content moderation when paired
 * with a "fitness model" prompt (skin exposure on legs / glutes etc). For
 * these we switch composition to a flat-lay / mannequin shot with no model.
 */
const LOWER_BODY_KEYWORDS = [
  "short",
  "shorts",
  "bermuda",
  "calça",
  "calca",
  "calcao",
  "calção",
  "legging",
  "leggin",
  "biker",
  "sunga",
  "swim",
  "underwear",
  "boxer",
  "cueca",
  "saia",
];

const SPORTSWEAR_REVEALING_KEYWORDS = ["top esportivo", "top fitness", "sutiã", "sutia", "bra"];

function isRevealingProduct(name: string): boolean {
  const n = name.toLowerCase();
  return (
    LOWER_BODY_KEYWORDS.some((k) => n.includes(k)) ||
    SPORTSWEAR_REVEALING_KEYWORDS.some((k) => n.includes(k))
  );
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

  // For revealing items we use a no-model flat-lay composition that keeps
  // the editorial aesthetic and consistently passes content moderation.
  const revealing = isRevealingProduct(product.name);

  const compositionWithModel: Record<LayoutId, string> = {
    classic:
      "vertical 3:4 editorial composition. Fully clothed athletic-build adult model wearing the product, three-quarter framing, hands relaxed, neutral expression. Soft neutral gradient background.",
    "editorial-overlay-light":
      "vertical 3:4 composition with the product (worn by a fully clothed athletic-build adult model in a calm pose) centered between two large words punched above and below in 84px sans-serif weight 500. Slot 1 words: TOP / SEMANA. Slot 2 words: ÚLTIMA / CHANCE. Slot 3 words: NOVO / DROP. Light gradient background.",
    "numbered-grid-light":
      "vertical 3:4 composition: a single fully clothed athletic-build adult model wearing the product, full body, centered, hands at sides, neutral pose. Pale cream paper-textured background. Optional small cursive number '1.' top-right corner.",
    "slash-labels-dark":
      "vertical 3:4 dark editorial composition. Fully clothed athletic-build adult model wearing the product, full body, dramatic side lighting, deep black gradient background. Small slash-separated meta labels in white sans-serif weight 500 floating top-left and bottom-right of the frame.",
    "single-detail-dark":
      "vertical 3:4 dark moody three-quarter portrait. Fully clothed athletic-build adult model wearing the product, soft directional rim light, gradient charcoal-to-black background. Shallow depth of field. Editorial, premium streetwear feel.",
  };

  // Flat-lay variants used for body-revealing items (shorts, leggings, etc).
  // These avoid models entirely and keep moderation green.
  const compositionFlatLay: Record<LayoutId, string> = {
    classic:
      "vertical 3:4 studio still-life. The product laid flat (or arranged on a clean invisible mannequin) centered against a soft neutral gradient backdrop. No human figure, no model. Clean shadows.",
    "editorial-overlay-light":
      "vertical 3:4 still-life composition. The product floats centered (flat-lay or invisible mannequin) between two large words punched above and below in 84px sans-serif weight 500. Slot 1 words: TOP / SEMANA. Slot 2 words: ÚLTIMA / CHANCE. Slot 3 words: NOVO / DROP. Light gradient background. No human figure.",
    "numbered-grid-light":
      "vertical 3:4 studio still-life. The product flat-lay or on an invisible mannequin, centered. Pale cream paper-textured background. Optional small cursive number '1.' top-right corner. No human figure.",
    "slash-labels-dark":
      "vertical 3:4 dark editorial still-life. The product floating (flat-lay or invisible mannequin) under dramatic side lighting on a deep black gradient backdrop. Small slash-separated meta labels in white sans-serif weight 500 top-left and bottom-right. No human figure.",
    "single-detail-dark":
      "vertical 3:4 dark moody product still-life. The product centered under soft directional rim light, gradient charcoal-to-black background. Shallow depth of field. No human figure. Editorial premium feel.",
  };

  const composition = revealing
    ? compositionFlatLay[layoutId]
    : compositionWithModel[layoutId];

  const safetyClause = revealing
    ? `IMPORTANT: do NOT depict a human model. Render the product alone as studio still-life or on an invisible mannequin. No bodies, no skin.`
    : `IMPORTANT: any model present must be fully clothed (no exposed midriff, no exposed legs above mid-thigh, no revealing poses). Conservative editorial styling like a magazine cover. Athletic build is fine; suggestive posing is not.`;

  const prompt = [
    `Generate a premium fashion email hero image for the streetwear/fitness apparel brand BULKING.`,
    `Use the FIRST input image as a visual style reference (composition, palette, type weight, mood).`,
    `Use the SECOND input image as the product to feature: "${product.name}". The product must be the visual centerpiece, faithfully reproduced (same colorway, garment shape, branding, every visible detail).`,
    "",
    `Composition: ${composition}`,
    `Mood: ${vibe}.`,
    "",
    safetyClause,
    "",
    `Typography on the image: render the text "${labelText}" in clean sans-serif at medium weight (500–600), monochrome, generous letter-spacing 0.2em–0.3em, all caps. Spell the text exactly, no decorative flourishes.`,
    `Also render the small product caption "${product.name.toUpperCase()}" in sans-serif weight 500, monochrome, letter-spacing 0.1em.`,
    "",
    `Color system: white, black, grays only. No saturated brand color anywhere on the image. Background is a soft neutral gradient (white-to-grey for light layouts, charcoal-to-black for dark layouts).`,
    `Negative space: generous. Avoid cluttered backgrounds, no busy graphic elements, no logos beyond the product itself.`,
    `Quality: editorial, magazine cover level. Sharp product reproduction. No text artifacts, no warped letters, no extra hands or limbs.`,
  ].join("\n");

  // Both references are passed; reference first, product second.
  return {
    prompt,
    input_urls: [refImage, productImage],
    reference_image: refFile,
    aspect_ratio: "3:4",
  };
}
