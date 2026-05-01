// src/lib/email-templates/layouts/uniform-grid-3x3-light.ts
//
// Inspired by The Initial Collection: a strict 3x3 grid of uniform thumbnails
// under a clean line of header type. The first cell is the primary product;
// the remaining 8 cells are related/suggested items (cycled if fewer).

import {
  TOKENS,
  ctaBlock,
  escapeHtml,
  footer,
  header,
  htmlClose,
  htmlOpen,
} from "../templates/shared";
import type { TemplateRenderContext, ProductSnapshot } from "../types";
import type { LayoutDef } from "./types";
import { SLOT_HOOK_DEFAULT } from "./_meta";

function cell(p: ProductSnapshot): string {
  return `
<td valign="top" align="center" width="33.33%" style="width:33.33%;padding:0 4px 8px;">
  <a href="${escapeHtml(p.url)}" target="_blank" style="text-decoration:none;color:${TOKENS.text};">
    <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}" width="180" height="240" style="width:100%;max-width:185px;height:auto;display:block;background:${TOKENS.bgAlt};" />
  </a>
</td>`;
}

function render(ctx: TemplateRenderContext): string {
  const { slot, copy, product, related_products } = ctx;
  const hook = ctx.hook ?? SLOT_HOOK_DEFAULT[slot];
  const items: ProductSnapshot[] = [product, ...related_products];
  while (items.length < 9) items.push(items[items.length % Math.max(1, related_products.length + 1)] ?? product);

  return [
    htmlOpen({ subject: copy.subject, preview: copy.lead }),
    header(),
    `
<tr><td class="pad-xl" style="padding:48px 28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td valign="top" width="60%" style="width:60%;">
        <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${TOKENS.textSecondary};text-transform:uppercase;margin-bottom:10px;">${escapeHtml(hook)}</div>
        <h1 class="h1" style="margin:0;font-family:${TOKENS.fontHead};font-weight:500;font-size:32px;line-height:1.05;color:${TOKENS.text};text-transform:uppercase;letter-spacing:-0.005em;">${escapeHtml(copy.headline)}</h1>
      </td>
      <td valign="top" align="right" width="40%" style="width:40%;">
        <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${TOKENS.text};text-transform:uppercase;">JET BLACK</div>
      </td>
    </tr>
  </table>
</td></tr>
<tr><td class="pad-l" style="padding:24px 24px 8px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>${cell(items[0])}${cell(items[1])}${cell(items[2])}</tr>
    <tr>${cell(items[3])}${cell(items[4])}${cell(items[5])}</tr>
    <tr>${cell(items[6])}${cell(items[7])}${cell(items[8])}</tr>
  </table>
</td></tr>
<tr><td align="center" class="pad-l" style="padding:32px 40px 8px;">
  <div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;line-height:1.7;color:${TOKENS.textMuted};max-width:440px;margin:0 auto;">${escapeHtml(copy.lead)}</div>
</td></tr>`,
    ctaBlock({ text: copy.cta_text, url: copy.cta_url }),
    footer(),
    htmlClose(),
  ].join("\n");
}

export const uniformGrid3x3LightLayout: LayoutDef = {
  id: "uniform-grid-3x3-light",
  pattern_name: "Uniform 3x3 thumbnail grid (light)",
  reference_image: "ref-7-initial-3x3.jpg",
  mode: "light",
  slots: [1, 3],
  product_count: 8,
  uses_hero: false,
  render,
};
