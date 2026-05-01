// src/lib/email-templates/layouts/single-detail-light.ts
//
// Light sibling of single-detail-dark. Single full-bleed product hero, two-line
// product name in editorial weight 500, paragraph anchored bottom-left,
// brand wordmark below. Light surface, plenty of negative space.

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

function splitTwoLines(name: string): [string, string] {
  const t = name.trim();
  if (t.length < 14) return [t, ""];
  let i = Math.floor(t.length / 2);
  while (i > 0 && t[i] !== " ") i--;
  if (i === 0) return [t, ""];
  return [t.slice(0, i), t.slice(i + 1)];
}

function render(ctx: TemplateRenderContext): string {
  const { slot, copy, product } = ctx;
  const hook = ctx.hook ?? SLOT_HOOK_DEFAULT[slot];
  const heroSrc = ctx.hero_url ?? product.image_url;
  const [line1, line2] = splitTwoLines(product.name);

  const oldPrice =
    product.old_price && product.old_price > product.price
      ? `<span style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;color:${TOKENS.textFaint};text-decoration:line-through;margin-right:12px;">R$ ${product.old_price.toFixed(2)}</span>`
      : "";

  return [
    htmlOpen({ subject: copy.subject, preview: copy.lead }),
    header(),
    `
<tr><td align="center" class="pad-l" style="padding:36px 32px 4px;">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${TOKENS.textSecondary};text-transform:uppercase;">${escapeHtml(hook)}</div>
</td></tr>
<tr><td style="padding:24px 0 0;">
  <img src="${escapeHtml(heroSrc)}" alt="${escapeHtml(product.name)}" width="600" height="780" style="width:100%;max-width:600px;height:auto;display:block;" />
</td></tr>
<tr><td align="left" class="pad-xl" style="padding:32px 40px 8px;">
  <h1 style="margin:0;font-family:${TOKENS.fontHead};font-weight:500;font-size:42px;line-height:1.05;color:${TOKENS.text};letter-spacing:-0.01em;text-transform:uppercase;">${escapeHtml(line1)}${line2 ? `<br />${escapeHtml(line2)}` : ""}</h1>
</td></tr>
<tr><td align="left" class="pad-l" style="padding:8px 40px 24px;">
  <p style="margin:0;font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;line-height:1.7;color:${TOKENS.textMuted};max-width:520px;">${escapeHtml(copy.lead)}</p>
</td></tr>
<tr><td align="left" class="pad-l" style="padding:0 40px 24px;">
  <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:13px;letter-spacing:0.32em;color:${TOKENS.text};text-transform:uppercase;">BULKING</div>
</td></tr>
<tr><td align="left" class="pad-l" style="padding:0 40px 16px;">
  <div>${oldPrice}<span style="font-family:${TOKENS.fontHead};font-weight:500;font-size:22px;color:${TOKENS.text};">R$ ${product.price.toFixed(2)}</span></div>
</td></tr>`,
    ctaBlock({ text: copy.cta_text, url: copy.cta_url }),
    footer(),
    htmlClose(),
  ].join("\n");
}

export const singleDetailLightLayout: LayoutDef = {
  id: "single-detail-light",
  pattern_name: "Single product detail (light)",
  reference_image: "ref-8-puffer-detail.jpg",
  mode: "light",
  slots: [1, 2, 3],
  product_count: 0,
  render,
};
