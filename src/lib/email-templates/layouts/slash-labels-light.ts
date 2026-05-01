// src/lib/email-templates/layouts/slash-labels-light.ts
//
// Light sibling of slash-labels-dark. Asics × BEAMS pattern on a white canvas:
// full-bleed product hero with slash-separated meta labels above and below.

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

const SLASH_LEFT: Record<1 | 2 | 3, string> = {
  1: "TOP / 2026",
  2: "EDIÇÃO / LIMITADA",
  3: "DROP / NOVO",
};
const SLASH_RIGHT: Record<1 | 2 | 3, string> = {
  1: "FW / DELIVERY",
  2: "ÚLTIMAS / PEÇAS",
  3: "FRESH / IN",
};

function dateLabel(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function render(ctx: TemplateRenderContext): string {
  const { slot, copy, product } = ctx;
  const hook = ctx.hook ?? SLOT_HOOK_DEFAULT[slot];
  const heroSrc = ctx.hero_url ?? product.image_url;
  const left = SLASH_LEFT[slot];
  const right = SLASH_RIGHT[slot];
  const date = dateLabel();

  const oldPrice =
    product.old_price && product.old_price > product.price
      ? `<span style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;color:${TOKENS.textFaint};text-decoration:line-through;margin-right:12px;">R$ ${product.old_price.toFixed(2)}</span>`
      : "";

  return [
    htmlOpen({ subject: copy.subject, preview: copy.lead }),
    header(),
    `
<tr><td style="padding:32px 32px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="left" valign="top" style="padding:0;">
        <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.28em;color:${TOKENS.text};text-transform:uppercase;">${escapeHtml(left)}</div>
      </td>
      <td align="right" valign="top" style="padding:0;">
        <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.28em;color:${TOKENS.textSecondary};text-transform:uppercase;">${escapeHtml(date)} / DELIVERY</div>
      </td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:0;">
  <img src="${escapeHtml(heroSrc)}" alt="${escapeHtml(product.name)}" width="600" height="780" style="width:100%;max-width:600px;height:auto;display:block;" />
</td></tr>
<tr><td style="padding:12px 32px 32px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="left" valign="top" style="padding:0;">
        <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.28em;color:${TOKENS.text};text-transform:uppercase;">FALL / WINTER ${new Date().getFullYear()}</div>
      </td>
      <td align="right" valign="top" style="padding:0;">
        <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.28em;color:${TOKENS.textSecondary};text-transform:uppercase;">${escapeHtml(right)}</div>
      </td>
    </tr>
  </table>
</td></tr>
<tr><td align="center" class="pad-l" style="padding:8px 40px 4px;">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${TOKENS.textSecondary};text-transform:uppercase;">${escapeHtml(hook)}</div>
</td></tr>
<tr><td align="center" class="pad-xl" style="padding:14px 40px 16px;">
  <h1 class="h1" style="margin:0;font-family:${TOKENS.fontHead};font-weight:500;font-size:36px;line-height:1.1;color:${TOKENS.text};">${escapeHtml(copy.headline)}</h1>
</td></tr>
<tr><td align="center" class="pad-l" style="padding:0 40px 24px;">
  <p style="margin:0;font-family:${TOKENS.fontBody};font-weight:400;font-size:15px;line-height:1.7;color:${TOKENS.textMuted};max-width:460px;margin:0 auto;">${escapeHtml(copy.lead)}</p>
</td></tr>
<tr><td align="center" class="pad-l" style="padding:0 40px 16px;">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:14px;color:${TOKENS.textMuted};">${escapeHtml(product.name)}</div>
  <div style="margin-top:4px;">${oldPrice}<span style="font-family:${TOKENS.fontHead};font-weight:500;font-size:22px;color:${TOKENS.text};">R$ ${product.price.toFixed(2)}</span></div>
</td></tr>`,
    ctaBlock({ text: copy.cta_text, url: copy.cta_url }),
    footer(),
    htmlClose(),
  ].join("\n");
}

export const slashLabelsLightLayout: LayoutDef = {
  id: "slash-labels-light",
  pattern_name: "Slash labels (light editorial)",
  reference_image: "ref-9-asics-slash.jpg",
  mode: "light",
  slots: [1, 2, 3],
  product_count: 0,
  render,
};
