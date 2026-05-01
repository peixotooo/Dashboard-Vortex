// src/lib/email-templates/layouts/editorial-overlay-dark.ts
//
// Same split-headline composition as editorial-overlay-light, but on a black
// canvas with white type. Inspired by the moodier black-friday templates that
// run the wordmark in inverted color.

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
import type { TemplateRenderContext } from "../types";
import type { LayoutDef } from "./types";
import { SLOT_HOOK_DEFAULT, SLOT_SPLIT_HEADLINE } from "./_meta";

function render(ctx: TemplateRenderContext): string {
  const { slot, copy, product } = ctx;
  const hook = ctx.hook ?? SLOT_HOOK_DEFAULT[slot];
  const [topWord, bottomWord] = SLOT_SPLIT_HEADLINE[slot];
  const heroSrc = ctx.hero_url ?? product.image_url;

  return [
    darkOpen({ subject: copy.subject, preview: copy.lead }),
    darkHeader(),
    `
<tr><td align="center" class="pad-l" style="padding:24px 32px 4px;background:${DARK.bg};">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${DARK.muted};text-transform:uppercase;">${escapeHtml(hook)}</div>
</td></tr>
<tr><td align="left" style="padding:24px 40px 0;background:${DARK.bg};">
  <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:84px;line-height:0.95;color:${DARK.fg};letter-spacing:-0.02em;text-transform:uppercase;">${escapeHtml(topWord)}</div>
</td></tr>
<tr><td style="padding:8px 0 0;background:${DARK.bg};">
  <img src="${escapeHtml(heroSrc)}" alt="${escapeHtml(product.name)}" width="600" height="600" style="width:100%;max-width:600px;height:auto;display:block;background:${DARK.bg};" />
</td></tr>
<tr><td align="right" style="padding:0 40px 16px;background:${DARK.bg};">
  <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:84px;line-height:0.95;color:${DARK.fg};letter-spacing:-0.02em;text-transform:uppercase;">${escapeHtml(bottomWord)}</div>
</td></tr>
<tr><td align="center" class="pad-l" style="padding:24px 40px 8px;background:${DARK.bg};">
  <p style="margin:0;font-family:${TOKENS.fontBody};font-weight:400;font-size:15px;line-height:1.7;color:${DARK.muted};max-width:440px;margin:0 auto;">${escapeHtml(copy.lead)}</p>
</td></tr>
<tr><td align="center" class="pad" style="padding:18px 40px 8px;background:${DARK.bg};">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:14px;color:${DARK.fg};letter-spacing:0.14em;">★★★★★</div>
</td></tr>
<tr><td align="center" class="pad-l" style="padding:0 40px 28px;background:${DARK.bg};">
  <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:18px;color:${DARK.fg};">R$ ${product.price.toFixed(2)}</div>
</td></tr>`,
    darkCtaBlock({ text: copy.cta_text, url: copy.cta_url }),
    darkFooter(),
    darkClose(),
  ].join("\n");
}

export const editorialOverlayDarkLayout: LayoutDef = {
  id: "editorial-overlay-dark",
  pattern_name: "Editorial overlay (split headline, dark)",
  reference_image: "ref-1-black-friday.jpg",
  mode: "dark",
  slots: [1, 2, 3],
  product_count: 0,
  render,
};
