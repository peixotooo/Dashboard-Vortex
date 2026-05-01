// src/lib/email-templates/layouts/overlay-dual-cta-dark.ts
import {
  DARK,
  TOKENS,
  darkClose,
  darkFooter,
  darkHeader,
  darkOpen,
  escapeHtml,
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
    darkOpen({ subject: copy.subject, preview: copy.lead }),
    darkHeader(),
    `
<tr><td style="padding:0;background:${DARK.bg};">
  <img src="${escapeHtml(heroSrc)}" alt="${escapeHtml(product.name)}" width="600" height="700" style="width:100%;max-width:600px;height:auto;display:block;background:${DARK.bg};" />
</td></tr>
<tr><td align="center" class="pad-xl" style="padding:36px 40px 12px;background:${DARK.bg};">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${DARK.muted};text-transform:uppercase;margin-bottom:12px;">${escapeHtml(hook)}</div>
  <h1 class="h1" style="margin:0;font-family:${TOKENS.fontHead};font-weight:500;font-size:36px;line-height:1.05;color:${DARK.fg};">${escapeHtml(copy.headline)}</h1>
</td></tr>
<tr><td align="center" class="pad-l" style="padding:8px 40px 28px;background:${DARK.bg};">
  <a href="${escapeHtml(copy.cta_url)}" target="_blank" style="display:inline-block;background:${DARK.fg};color:${DARK.bg};font-family:${TOKENS.fontHead};font-weight:600;font-size:12px;letter-spacing:0.28em;text-transform:uppercase;text-decoration:none;padding:16px 30px;margin:6px 4px;border:1px solid ${DARK.fg};">${escapeHtml(copy.cta_text)}</a>
  <a href="${escapeHtml(copy.cta_url)}" target="_blank" style="display:inline-block;background:${DARK.bg};color:${DARK.fg};font-family:${TOKENS.fontHead};font-weight:600;font-size:12px;letter-spacing:0.28em;text-transform:uppercase;text-decoration:none;padding:16px 30px;margin:6px 4px;border:1px solid ${DARK.fg};">Ver coleção</a>
</td></tr>
<tr><td class="pad-l" style="padding:0 28px 16px;background:${DARK.bg};">
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
    darkFooter(),
    darkClose(),
  ].join("\n");
}

export const overlayDualCtaDarkLayout: LayoutDef = {
  id: "overlay-dual-cta-dark",
  pattern_name: "Hero overlay with dual CTA (dark)",
  reference_image: "ref-4-society-overlay.jpg",
  mode: "dark",
  slots: [1, 2, 3],
  product_count: 3,
  render,
};
