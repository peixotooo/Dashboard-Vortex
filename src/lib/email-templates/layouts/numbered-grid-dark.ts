// src/lib/email-templates/layouts/numbered-grid-dark.ts
//
// Dark sibling of numbered-grid-light. 2x2 numbered product grid on a deep
// black canvas with white sketch numbers.

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

const SECTION_TITLE: Record<1 | 2 | 3, string> = {
  1: "Top picks da semana",
  2: "Quatro pra levar agora",
  3: "Quatro recém-chegados",
};

function gridCell(index: number, p: ProductSnapshot): string {
  const oldPrice =
    p.old_price && p.old_price > p.price
      ? `<div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:12px;color:${DARK.faint};text-decoration:line-through;margin-top:4px;">R$ ${p.old_price.toFixed(2)}</div>`
      : "";
  return `
<td valign="top" align="center" width="50%" class="related-cell" style="width:50%;padding:0 12px 40px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding:0;">
      <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}" width="270" height="340" style="width:100%;max-width:280px;height:auto;display:block;background:${DARK.surfaceAlt};" />
    </td></tr>
    <tr><td align="left" style="padding:14px 6px 0;">
      <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:42px;line-height:1;color:${DARK.fg};letter-spacing:-0.01em;font-style:italic;">${index}.</div>
    </td></tr>
    <tr><td align="left" style="padding:6px 6px 0;">
      <a href="${escapeHtml(p.url)}" target="_blank" style="text-decoration:none;color:${DARK.fg};">
        <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:14px;color:${DARK.fg};line-height:1.4;">${escapeHtml(p.name)}</div>
      </a>
      <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:16px;color:${DARK.fg};margin-top:4px;">R$ ${p.price.toFixed(2)}</div>
      ${oldPrice}
    </td></tr>
  </table>
</td>`;
}

function render(ctx: TemplateRenderContext): string {
  const { slot, copy, product, related_products } = ctx;
  const hook = ctx.hook ?? SLOT_HOOK_DEFAULT[slot];
  const four: ProductSnapshot[] = [product, ...related_products].slice(0, 4);
  while (four.length < 4) four.push(four[0]);

  return [
    darkOpen({ subject: copy.subject, preview: copy.lead }),
    darkHeader(),
    `
<tr><td align="center" class="pad-l" style="padding:36px 32px 6px;background:${DARK.bg};">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${DARK.muted};text-transform:uppercase;">${escapeHtml(hook)}</div>
</td></tr>
<tr><td align="center" class="pad-xl" style="padding:8px 40px 20px;background:${DARK.bg};">
  <h1 class="h1" style="margin:0;font-family:${TOKENS.fontHead};font-weight:500;font-size:38px;line-height:1.05;color:${DARK.fg};letter-spacing:-0.005em;text-transform:uppercase;font-style:italic;">${escapeHtml(SECTION_TITLE[slot])}</h1>
</td></tr>
<tr><td class="pad-l" style="padding:24px 28px 8px;background:${DARK.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>${gridCell(1, four[0])}${gridCell(2, four[1])}</tr>
    <tr>${gridCell(3, four[2])}${gridCell(4, four[3])}</tr>
  </table>
</td></tr>
<tr><td align="center" class="pad-l" style="padding:24px 40px 8px;background:${DARK.bg};">
  <div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;line-height:1.7;color:${DARK.muted};max-width:440px;margin:0 auto;">${escapeHtml(copy.lead)}</div>
</td></tr>`,
    darkCtaBlock({ text: copy.cta_text, url: copy.cta_url }),
    darkFooter(),
    darkClose(),
  ].join("\n");
}

export const numberedGridDarkLayout: LayoutDef = {
  id: "numbered-grid-dark",
  pattern_name: "Numbered 2x2 grid (dark)",
  reference_image: "ref-6-numbered-grid.jpg",
  mode: "dark",
  slots: [1, 3],
  product_count: 3,
  uses_hero: false,
  render,
};
