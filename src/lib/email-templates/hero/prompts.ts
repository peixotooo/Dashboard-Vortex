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

// Layout id → reference filename in public/hero-refs/. Light/dark variants of
// the same pattern share the same reference image (their visual structure is
// the same; only palette inverts).
const LAYOUT_REF: Record<LayoutId, string> = {
  classic: "ref-8-puffer-detail.jpg",
  "editorial-overlay-light": "ref-1-black-friday.jpg",
  "editorial-overlay-dark": "ref-1-black-friday.jpg",
  "reviews-side-hero-light": "ref-2-flaw-reviews.jpg",
  "reviews-side-hero-dark": "ref-2-flaw-reviews.jpg",
  "logo-asym-narrative-light": "ref-3-void-asym.jpg",
  "logo-asym-narrative-dark": "ref-3-void-asym.jpg",
  "overlay-dual-cta-light": "ref-4-society-overlay.jpg",
  "overlay-dual-cta-dark": "ref-4-society-overlay.jpg",
  "edition-narrative-light": "ref-5-represent-edition.jpg",
  "edition-narrative-dark": "ref-5-represent-edition.jpg",
  "numbered-grid-light": "ref-6-numbered-grid.jpg",
  "numbered-grid-dark": "ref-6-numbered-grid.jpg",
  "uniform-grid-3x3-light": "ref-7-initial-3x3.jpg",
  "uniform-grid-3x3-dark": "ref-7-initial-3x3.jpg",
  "single-detail-light": "ref-8-puffer-detail.jpg",
  "single-detail-dark": "ref-8-puffer-detail.jpg",
  "slash-labels-light": "ref-9-asics-slash.jpg",
  "slash-labels-dark": "ref-9-asics-slash.jpg",
  "blur-bestsellers-light": "ref-10-faine-blur.jpg",
  "blur-bestsellers-dark": "ref-10-faine-blur.jpg",
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
 * Strips the trailing -light / -dark variant suffix from a LayoutId and
 * returns the family name (e.g. "editorial-overlay-light" → "editorial-overlay").
 */
function layoutFamily(id: LayoutId): string {
  return id.replace(/-(light|dark)$/, "");
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

  // Composition guidance per layout family. Light/dark variants share the
  // same instruction; only the surface tone changes (controlled by `mode`).
  const family = layoutFamily(layoutId);
  const isDark = layoutId.endsWith("-dark");
  const surface = isDark
    ? "deep charcoal-to-black gradient background"
    : "soft white-to-light-grey gradient background";

  const compositionFamily: Record<string, string> = {
    "editorial-overlay":
      `vertical 3:4 composition with the product centered between two large words punched above and below in 84px sans-serif weight 500. ${surface}.`,
    "reviews-side-hero":
      `vertical 3:4 composition. Centered three-quarter portrait of the product on a ${surface}. Negative space top-left for floating typography.`,
    "logo-asym-narrative":
      `vertical 3:4 asymmetric composition. The product on the right two-thirds with the left third reserved for typography. ${surface}.`,
    "overlay-dual-cta":
      `vertical 3:4 full-bleed product portrait. The product fills the frame for an over-headline composition. ${surface}.`,
    "edition-narrative":
      `vertical 3:4 portrait composition. Three-quarter framing of the product, magazine cover energy. ${surface}.`,
    "numbered-grid":
      `vertical 3:4 single-product crop suitable for a 2x2 grid cell. Centered, plenty of breathing room. ${surface}.`,
    "uniform-grid-3x3":
      `vertical 3:4 uniform thumbnail-style crop. Centered product, generous margin. ${surface}.`,
    "single-detail":
      `vertical 3:4 dominant single-product portrait. Soft directional light, shallow depth of field. ${surface}.`,
    "slash-labels":
      `vertical 3:4 editorial still-life. The product framed in the center with empty negative space top-left and bottom-right for slash-separated meta labels in sans-serif weight 500. ${surface}.`,
    "blur-bestsellers":
      `vertical 3:4 atmospheric soft-focus hero. Subtle motion blur on the background while the product stays sharp. ${surface}.`,
    classic: `vertical 3:4 editorial composition. The product centered, ${surface}.`,
  };

  const baseComposition = compositionFamily[family] ?? compositionFamily.classic;
  const modelClause = revealing
    ? "No human figure. Studio still-life or invisible-mannequin treatment."
    : "Fully clothed athletic-build adult model wearing the product, three-quarter framing, hands relaxed, neutral expression. No exposed midriff. No exposed legs above mid-thigh.";
  const composition = `${baseComposition} ${modelClause}`;

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
