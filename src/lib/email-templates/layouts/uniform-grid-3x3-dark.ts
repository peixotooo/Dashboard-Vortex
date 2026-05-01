// src/lib/email-templates/layouts/uniform-grid-3x3-dark.ts
import {
  DARK,
  TOKENS,
  darkClose,
  darkCtaBlock,
  darkFooter,
  darkHeader,
  darkOpen,
  escapeHtml,
} from "../templates/shared";
import type { TemplateRenderContext, ProductSnapshot } from "../types";
import type { LayoutDef } from "./types";
import { SLOT_HOOK_DEFAULT } from "./_meta";

function cell(p: ProductSnapshot): string {
  return `
<td valign="top" align="center" width="33.33%" style="width:33.33%;padding:0 4px 8px;">
  <a href="${escapeHtml(p.url)}" target="_blank" style="text-decoration:none;color:${DARK.fg};">
    <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}" width="180" height="240" style="width:100%;max-width:185px;height:auto;display:block;background:${DARK.surfaceAlt};" />
  </a>
</td>`;
}

function render(ctx: TemplateRenderContext): string {
  const { slot, copy, product, related_products } = ctx;
  const hook = ctx.hook ?? SLOT_HOOK_DEFAULT[slot];
  const items: ProductSnapshot[] = [product, ...related_products];
  while (items.length < 9) items.push(items[items.length % Math.max(1, related_products.length + 1)] ?? product);

  return [
    darkOpen({ subject: copy.subject, preview: copy.lead }),
    darkHeader(),
    `
<tr><td class="pad-xl" style="padding:48px 28px 12px;background:${DARK.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td valign="top" width="60%" style="width:60%;">
        <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${DARK.muted};text-transform:uppercase;margin-bottom:10px;">${escapeHtml(hook)}</div>
        <h1 class="h1" style="margin:0;font-family:${TOKENS.fontHead};font-weight:500;font-size:32px;line-height:1.05;color:${DARK.fg};text-transform:uppercase;letter-spacing:-0.005em;">${escapeHtml(copy.headline)}</h1>
      </td>
      <td valign="top" align="right" width="40%" style="width:40%;">
        <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${DARK.fg};text-transform:uppercase;">JET BLACK</div>
      </td>
    </tr>
  </table>
</td></tr>
<tr><td class="pad-l" style="padding:24px 24px 8px;background:${DARK.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>${cell(items[0])}${cell(items[1])}${cell(items[2])}</tr>
    <tr>${cell(items[3])}${cell(items[4])}${cell(items[5])}</tr>
    <tr>${cell(items[6])}${cell(items[7])}${cell(items[8])}</tr>
  </table>
</td></tr>
<tr><td align="center" class="pad-l" style="padding:32px 40px 8px;background:${DARK.bg};">
  <div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;line-height:1.7;color:${DARK.muted};max-width:440px;margin:0 auto;">${escapeHtml(copy.lead)}</div>
</td></tr>`,
    darkCtaBlock({ text: copy.cta_text, url: copy.cta_url }),
    darkFooter(),
    darkClose(),
  ].join("\n");
}

export const uniformGrid3x3DarkLayout: LayoutDef = {
  id: "uniform-grid-3x3-dark",
  pattern_name: "Uniform 3x3 thumbnail grid (dark)",
  reference_image: "ref-7-initial-3x3.jpg",
  mode: "dark",
  slots: [1, 3],
  product_count: 8,
  uses_hero: false,
  render,
};
