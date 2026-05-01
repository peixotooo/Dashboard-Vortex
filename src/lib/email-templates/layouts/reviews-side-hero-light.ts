// src/lib/email-templates/layouts/reviews-side-hero-light.ts
//
// 2-column composition inspired by FLAW 2024 Winter: 3 stacked star reviews on
// the left rail, hero photo on the right. Editorial typography, light surface.

import {
  TOKENS,
  ctaBlock,
  escapeHtml,
  footer,
  header,
  htmlClose,
  htmlOpen,
} from "../templates/shared";
import type { TemplateRenderContext } from "../types";
import type { LayoutDef } from "./types";
import { SLOT_HOOK_DEFAULT } from "./_meta";

const REVIEWS = [
  { stars: 5, quote: "Caimento absurdo." },
  { stars: 5, quote: "Vestiu como tinha que vestir." },
  { stars: 5, quote: "Melhor compra do ano." },
];

function render(ctx: TemplateRenderContext): string {
  const { slot, copy, product } = ctx;
  const hook = ctx.hook ?? SLOT_HOOK_DEFAULT[slot];
  const heroSrc = ctx.hero_url ?? product.image_url;

  const reviewsHtml = REVIEWS.map(
    (r) => `
<div style="margin-bottom:28px;">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:13px;color:${TOKENS.text};letter-spacing:0.12em;">${"★".repeat(r.stars)}</div>
  <div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:13px;color:${TOKENS.textSecondary};margin-top:6px;">"${escapeHtml(r.quote)}"</div>
</div>`
  ).join("");

  return [
    htmlOpen({ subject: copy.subject, preview: copy.lead }),
    header(),
    `
<tr><td align="center" class="pad-l" style="padding:32px 40px 4px;">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${TOKENS.textSecondary};text-transform:uppercase;">${escapeHtml(hook)}</div>
</td></tr>
<tr><td align="center" class="pad-xl" style="padding:14px 40px 28px;">
  <h1 class="h1" style="margin:0;font-family:${TOKENS.fontHead};font-weight:500;font-size:34px;line-height:1.1;color:${TOKENS.text};">${escapeHtml(copy.headline)}</h1>
</td></tr>
<tr><td class="pad-l" style="padding:0 40px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td valign="top" width="42%" style="width:42%;padding-right:20px;">${reviewsHtml}</td>
      <td valign="top" width="58%" style="width:58%;">
        <img src="${escapeHtml(heroSrc)}" alt="${escapeHtml(product.name)}" width="320" height="420" style="width:100%;max-width:320px;height:auto;display:block;" />
      </td>
    </tr>
  </table>
</td></tr>
<tr><td align="center" class="pad-l" style="padding:8px 40px 24px;">
  <div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;color:${TOKENS.textMuted};line-height:1.7;max-width:440px;margin:0 auto;">${escapeHtml(copy.lead)}</div>
</td></tr>
<tr><td align="center" class="pad-l" style="padding:8px 40px 12px;">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:14px;color:${TOKENS.text};">${escapeHtml(product.name)}</div>
  <div style="font-family:${TOKENS.fontHead};font-weight:600;font-size:20px;color:${TOKENS.text};margin-top:6px;">R$ ${product.price.toFixed(2)}</div>
</td></tr>`,
    ctaBlock({ text: copy.cta_text, url: copy.cta_url }),
    footer(),
    htmlClose(),
  ].join("\n");
}

export const reviewsSideHeroLightLayout: LayoutDef = {
  id: "reviews-side-hero-light",
  pattern_name: "Reviews + hero side-by-side (light)",
  reference_image: "ref-2-flaw-reviews.jpg",
  mode: "light",
  slots: [1, 2, 3],
  product_count: 0,
  render,
};
