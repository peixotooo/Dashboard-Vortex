// src/lib/email-templates/layouts/numbered-grid-light.ts
//
// 2x2 numbered product grid. Inspired by the Cold Outfit Ideas reference:
// 4 figures, each with a sketch-style number ("1." "2." "3." "4."), captioned
// underneath. Light surface, monochrome. Editorial weight 500 typography.
//
// Reference: public/Hero Emails/download_7.jfif

import {
  ctaBlock,
  escapeHtml,
  footer,
  header,
  htmlClose,
  htmlOpen,
  TOKENS,
  topCountdownBlock,
} from "../templates/shared";
import type { TemplateRenderContext, ProductSnapshot } from "../types";
import type { LayoutDef } from "./types";
import { SLOT_HOOK_DEFAULT } from "./_meta";

const SECTION_TITLE: Record<1 | 2 | 3, string> = {
  1: "Top picks da semana",
  2: "Quatro pra levar agora",
  3: "Quatro recém-chegados",
};

function gridCell(index: number, product: ProductSnapshot): string {
  const oldPrice =
    product.old_price && product.old_price > product.price
      ? `<div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:12px;color:${TOKENS.textFaint};text-decoration:line-through;margin-top:4px;">R$ ${product.old_price.toFixed(2)}</div>`
      : "";

  return `
<td valign="top" align="center" width="50%" class="related-cell" style="width:50%;padding:0 12px 40px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="position:relative;padding:0;">
      <img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}" width="270" height="340" style="width:100%;max-width:280px;height:auto;display:block;background:${TOKENS.bgAlt};" />
    </td></tr>
    <tr><td align="left" style="padding:14px 6px 0;">
      <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:42px;line-height:1;color:${TOKENS.text};letter-spacing:-0.01em;font-style:italic;">${index}.</div>
    </td></tr>
    <tr><td align="left" style="padding:6px 6px 0;">
      <a href="${escapeHtml(product.url)}" target="_blank" style="text-decoration:none;color:${TOKENS.text};">
        <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:14px;color:${TOKENS.text};line-height:1.4;">${escapeHtml(product.name)}</div>
      </a>
      <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:16px;color:${TOKENS.text};margin-top:4px;">R$ ${product.price.toFixed(2)}</div>
      ${oldPrice}
    </td></tr>
  </table>
</td>`;
}

function render(ctx: TemplateRenderContext): string {
  const { slot, copy, product, coupon, related_products } = ctx;
  const hook = ctx.hook ?? SLOT_HOOK_DEFAULT[slot];

  // Compose four products: primary first, then up to 3 related.
  const four: ProductSnapshot[] = [product, ...related_products].slice(0, 4);
  while (four.length < 4) four.push(four[0]); // safe fallback to keep grid whole

  const blocks: string[] = [
    htmlOpen({ subject: copy.subject, preview: copy.lead }),
    header(),
  ];

  if (slot === 2 && coupon) {
    blocks.push(
      topCountdownBlock({
        countdown_url: coupon.countdown_url,
        expires_at: coupon.expires_at,
      })
    );
  }

  blocks.push(`
<tr><td align="center" class="pad-l" style="padding:36px 32px 6px;">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${TOKENS.textSecondary};text-transform:uppercase;">${escapeHtml(hook)}</div>
</td></tr>
<tr><td align="center" class="pad-xl" style="padding:8px 40px 20px;">
  <h1 class="h1" style="margin:0;font-family:${TOKENS.fontHead};font-weight:500;font-size:38px;line-height:1.05;color:${TOKENS.text};letter-spacing:-0.005em;text-transform:uppercase;font-style:italic;">${escapeHtml(SECTION_TITLE[slot])}</h1>
</td></tr>`);

  blocks.push(`
<tr><td class="pad-l" style="padding:24px 28px 8px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>${gridCell(1, four[0])}${gridCell(2, four[1])}</tr>
    <tr>${gridCell(3, four[2])}${gridCell(4, four[3])}</tr>
  </table>
</td></tr>`);

  blocks.push(`
<tr><td align="center" class="pad-l" style="padding:24px 40px 8px;">
  <div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;line-height:1.7;color:${TOKENS.textMuted};max-width:440px;margin:0 auto;">${escapeHtml(copy.lead)}</div>
</td></tr>`);

  blocks.push(
    ctaBlock({ text: copy.cta_text, url: copy.cta_url }),
    footer(),
    htmlClose()
  );

  return blocks.join("\n");
}

export const numberedGridLightLayout: LayoutDef = {
  id: "numbered-grid-light",
  pattern_name: "Numbered 2x2 grid",
  reference_image: "download_7.jfif",
  mode: "light",
  slots: [1, 3],
  product_count: 3,
  uses_hero: false,
  render,
};
