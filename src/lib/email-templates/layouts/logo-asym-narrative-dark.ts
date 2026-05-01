// src/lib/email-templates/layouts/logo-asym-narrative-dark.ts
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
import { SLOT_HOOK_DEFAULT } from "./_meta";

function render(ctx: TemplateRenderContext): string {
  const { slot, copy, product, related_products } = ctx;
  const hook = ctx.hook ?? SLOT_HOOK_DEFAULT[slot];
  const heroSrc = ctx.hero_url ?? product.image_url;
  const thumbs = related_products.slice(0, 3);

  return [
    darkOpen({ subject: copy.subject, preview: copy.lead }),
    darkHeader(),
    `
<tr><td class="pad-xl" style="padding:48px 32px 12px;background:${DARK.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td valign="top" width="46%" style="width:46%;padding-right:20px;">
        <div style="font-family:${TOKENS.fontHead};font-weight:600;font-size:13px;letter-spacing:0.32em;color:${DARK.fg};text-transform:uppercase;margin-bottom:18px;">${escapeHtml(hook)}</div>
        <h1 class="h1" style="margin:0;font-family:${TOKENS.fontHead};font-weight:500;font-size:42px;line-height:1.0;color:${DARK.fg};letter-spacing:-0.01em;text-transform:uppercase;">${escapeHtml(copy.headline)}</h1>
      </td>
      <td valign="top" width="54%" style="width:54%;">
        <img src="${escapeHtml(heroSrc)}" alt="${escapeHtml(product.name)}" width="300" height="400" style="width:100%;max-width:300px;height:auto;display:block;" />
      </td>
    </tr>
  </table>
</td></tr>
<tr><td class="pad-l" style="padding:24px 32px 8px;background:${DARK.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      ${thumbs
        .map(
          (p) => `<td valign="top" align="center" width="33%" style="width:33%;padding:0 6px;">
        <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}" width="170" height="220" style="width:100%;max-width:180px;height:auto;display:block;" />
      </td>`
        )
        .join("")}
    </tr>
  </table>
</td></tr>
<tr><td align="left" class="pad-l" style="padding:24px 40px 0;background:${DARK.bg};">
  <div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;color:${DARK.muted};line-height:1.7;max-width:480px;">${escapeHtml(copy.lead)}</div>
</td></tr>
<tr><td align="left" class="pad-l" style="padding:16px 40px 8px;background:${DARK.bg};">
  <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:14px;color:${DARK.fg};letter-spacing:0.04em;">${escapeHtml(product.name)} · R$ ${product.price.toFixed(2)}</div>
</td></tr>`,
    darkCtaBlock({ text: copy.cta_text, url: copy.cta_url }),
    darkFooter(),
    darkClose(),
  ].join("\n");
}

export const logoAsymNarrativeDarkLayout: LayoutDef = {
  id: "logo-asym-narrative-dark",
  pattern_name: "Logo asymmetric + narrative (dark)",
  reference_image: "ref-3-void-asym.jpg",
  mode: "dark",
  slots: [1, 2, 3],
  product_count: 3,
  render,
};
