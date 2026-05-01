// src/lib/email-templates/layouts/overlay-dual-cta-light.ts
//
// Inspired by Society Studios: full-bleed hero with overlaid bold headline
// and TWO CTA buttons (primary filled black, secondary outline). 2x2 thumb
// grid below. Light surface.

import {
  TOKENS,
  escapeHtml,
  footer,
  header,
  htmlClose,
  htmlOpen,
} from "../templates/shared";
import type { TemplateRenderContext } from "../types";
import type { LayoutDef } from "./types";
import { SLOT_HOOK_DEFAULT } from "./_meta";

function render(ctx: TemplateRenderContext): string {
  const { slot, copy, product, related_products } = ctx;
  const hook = ctx.hook ?? SLOT_HOOK_DEFAULT[slot];
  const heroSrc = ctx.hero_url ?? product.image_url;
  const thumbs = related_products.slice(0, 4);
  while (thumbs.length < 4) thumbs.push(thumbs[0] ?? product);

  return [
    htmlOpen({ subject: copy.subject, preview: copy.lead }),
    header(),
    `
<tr><td style="padding:0;">
  <img src="${escapeHtml(heroSrc)}" alt="${escapeHtml(product.name)}" width="600" height="700" style="width:100%;max-width:600px;height:auto;display:block;" />
</td></tr>
<tr><td align="center" class="pad-xl" style="padding:36px 40px 12px;">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${TOKENS.textSecondary};text-transform:uppercase;margin-bottom:12px;">${escapeHtml(hook)}</div>
  <h1 class="h1" style="margin:0;font-family:${TOKENS.fontHead};font-weight:500;font-size:36px;line-height:1.05;color:${TOKENS.text};">${escapeHtml(copy.headline)}</h1>
</td></tr>
<tr><td align="center" class="pad-l" style="padding:8px 40px 28px;">
  <a href="${escapeHtml(copy.cta_url)}" target="_blank" style="display:inline-block;background:${TOKENS.text};color:${TOKENS.bg};font-family:${TOKENS.fontHead};font-weight:600;font-size:12px;letter-spacing:0.28em;text-transform:uppercase;text-decoration:none;padding:16px 30px;margin:6px 4px;border:1px solid ${TOKENS.text};">${escapeHtml(copy.cta_text)}</a>
  <a href="${escapeHtml(copy.cta_url)}" target="_blank" style="display:inline-block;background:${TOKENS.bg};color:${TOKENS.text};font-family:${TOKENS.fontHead};font-weight:600;font-size:12px;letter-spacing:0.28em;text-transform:uppercase;text-decoration:none;padding:16px 30px;margin:6px 4px;border:1px solid ${TOKENS.text};">Ver coleção</a>
</td></tr>
<tr><td class="pad-l" style="padding:0 28px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td valign="top" align="center" width="50%" style="width:50%;padding:0 8px 16px;">
        <img src="${escapeHtml(thumbs[0].image_url)}" alt="${escapeHtml(thumbs[0].name)}" width="270" height="340" style="width:100%;max-width:280px;height:auto;display:block;" />
      </td>
      <td valign="top" align="center" width="50%" style="width:50%;padding:0 8px 16px;">
        <img src="${escapeHtml(thumbs[1].image_url)}" alt="${escapeHtml(thumbs[1].name)}" width="270" height="340" style="width:100%;max-width:280px;height:auto;display:block;" />
      </td>
    </tr>
    <tr>
      <td valign="top" align="center" width="50%" style="width:50%;padding:0 8px 16px;">
        <img src="${escapeHtml(thumbs[2].image_url)}" alt="${escapeHtml(thumbs[2].name)}" width="270" height="340" style="width:100%;max-width:280px;height:auto;display:block;" />
      </td>
      <td valign="top" align="center" width="50%" style="width:50%;padding:0 8px 16px;">
        <img src="${escapeHtml(thumbs[3].image_url)}" alt="${escapeHtml(thumbs[3].name)}" width="270" height="340" style="width:100%;max-width:280px;height:auto;display:block;" />
      </td>
    </tr>
  </table>
</td></tr>`,
    footer(),
    htmlClose(),
  ].join("\n");
}

export const overlayDualCtaLightLayout: LayoutDef = {
  id: "overlay-dual-cta-light",
  pattern_name: "Hero overlay with dual CTA (light)",
  reference_image: "ref-4-society-overlay.jpg",
  mode: "light",
  slots: [1, 2, 3],
  product_count: 3,
  render,
};
