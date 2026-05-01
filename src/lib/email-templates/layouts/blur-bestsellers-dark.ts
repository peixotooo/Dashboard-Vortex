// src/lib/email-templates/layouts/blur-bestsellers-dark.ts
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

function bsCell(p: ProductSnapshot): string {
  return `
<td valign="top" align="center" width="25%" style="width:25%;padding:0 6px 16px;">
  <a href="${escapeHtml(p.url)}" target="_blank" style="text-decoration:none;color:${DARK.fg};">
    <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}" width="130" height="170" style="width:100%;max-width:140px;height:auto;display:block;background:${DARK.surfaceAlt};" />
    <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;color:${DARK.fg};line-height:1.3;margin-top:8px;min-height:32px;letter-spacing:0.04em;">${escapeHtml(p.name)}</div>
    <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:13px;color:${DARK.fg};margin-top:4px;">R$ ${p.price.toFixed(2)}</div>
  </a>
</td>`;
}

function render(ctx: TemplateRenderContext): string {
  const { slot, copy, product, related_products } = ctx;
  const hook = ctx.hook ?? SLOT_HOOK_DEFAULT[slot];
  const heroSrc = ctx.hero_url ?? product.image_url;
  const four: ProductSnapshot[] = [product, ...related_products].slice(0, 4);
  while (four.length < 4) four.push(four[0]);

  return [
    darkOpen({ subject: copy.subject, preview: copy.lead }),
    darkHeader(),
    `
<tr><td style="padding:0;background:${DARK.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding:0;">
      <img src="${escapeHtml(heroSrc)}" alt="${escapeHtml(product.name)}" width="600" height="380" style="width:100%;max-width:600px;height:auto;display:block;background:${DARK.surfaceAlt};filter:blur(2px) brightness(0.7);" />
    </td></tr>
    <tr><td align="center" style="padding:24px 32px 28px;">
      <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:64px;line-height:1;letter-spacing:0.18em;color:${DARK.fg};text-transform:uppercase;">BULKING</div>
      <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${DARK.muted};text-transform:uppercase;margin-top:12px;">${escapeHtml(hook)}</div>
    </td></tr>
  </table>
</td></tr>
<tr><td class="pad-l" style="padding:24px 24px 8px;background:${DARK.bg};">
  <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:13px;letter-spacing:0.32em;color:${DARK.fg};text-transform:uppercase;margin-bottom:14px;text-align:center;">/ Mais vestidos</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>${bsCell(four[0])}${bsCell(four[1])}${bsCell(four[2])}${bsCell(four[3])}</tr>
  </table>
</td></tr>
<tr><td align="center" class="pad-l" style="padding:24px 40px 8px;background:${DARK.bg};">
  <p style="margin:0;font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;line-height:1.7;color:${DARK.muted};max-width:440px;margin:0 auto;">${escapeHtml(copy.lead)}</p>
</td></tr>`,
    darkCtaBlock({ text: copy.cta_text, url: copy.cta_url }),
    darkFooter(),
    darkClose(),
  ].join("\n");
}

export const blurBestsellersDarkLayout: LayoutDef = {
  id: "blur-bestsellers-dark",
  pattern_name: "Blur hero + bestsellers row (dark)",
  reference_image: "ref-10-faine-blur.jpg",
  mode: "dark",
  slots: [1, 2, 3],
  product_count: 3,
  render,
};
