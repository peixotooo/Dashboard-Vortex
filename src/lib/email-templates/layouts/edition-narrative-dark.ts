// src/lib/email-templates/layouts/edition-narrative-dark.ts
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
  const { slot, copy, product, related_products } = ctx;
  const hook = ctx.hook ?? SLOT_HOOK_DEFAULT[slot];
  const heroSrc = ctx.hero_url ?? product.image_url;
  const [t1, t2] = SLOT_SPLIT_HEADLINE[slot];
  const thumbs = related_products.slice(0, 3);

  return [
    darkOpen({ subject: copy.subject, preview: copy.lead }),
    darkHeader(),
    `
<tr><td class="pad-xl" style="padding:48px 32px 24px;background:${DARK.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td valign="top" width="48%" style="width:48%;padding-right:24px;">
        <div style="font-family:${TOKENS.fontHead};font-weight:600;font-size:11px;letter-spacing:0.32em;color:${DARK.fg};text-transform:uppercase;margin-bottom:14px;">${escapeHtml(hook)}</div>
        <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:46px;line-height:0.95;color:${DARK.fg};letter-spacing:-0.01em;text-transform:uppercase;">${escapeHtml(t1)}</div>
        <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:46px;line-height:0.95;color:${DARK.fg};letter-spacing:-0.01em;text-transform:uppercase;">${escapeHtml(t2)}</div>
        <div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:13px;line-height:1.7;color:${DARK.muted};margin-top:18px;">${escapeHtml(copy.lead)}</div>
        <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.28em;color:${DARK.fg};text-transform:uppercase;margin-top:18px;">Para quem treina, com intenção</div>
      </td>
      <td valign="top" width="52%" style="width:52%;">
        <img src="${escapeHtml(heroSrc)}" alt="${escapeHtml(product.name)}" width="290" height="420" style="width:100%;max-width:300px;height:auto;display:block;" />
      </td>
    </tr>
  </table>
</td></tr>
<tr><td class="pad-l" style="padding:8px 28px 16px;background:${DARK.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      ${thumbs
        .map(
          (p) => `<td valign="top" align="center" width="33%" style="width:33%;padding:0 8px;">
        <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}" width="160" height="220" style="width:100%;max-width:170px;height:auto;display:block;" />
      </td>`
        )
        .join("")}
    </tr>
  </table>
</td></tr>
<tr><td align="center" class="pad-l" style="padding:24px 40px 8px;background:${DARK.bg};">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:14px;color:${DARK.fg};">${escapeHtml(product.name)}</div>
  <div style="font-family:${TOKENS.fontHead};font-weight:600;font-size:20px;color:${DARK.fg};margin-top:6px;">R$ ${product.price.toFixed(2)}</div>
</td></tr>`,
    darkCtaBlock({ text: copy.cta_text, url: copy.cta_url }),
    darkFooter(),
    darkClose(),
  ].join("\n");
}

export const editionNarrativeDarkLayout: LayoutDef = {
  id: "edition-narrative-dark",
  pattern_name: "Edition narrative + multi-shot (dark)",
  reference_image: "ref-5-represent-edition.jpg",
  mode: "dark",
  slots: [1, 2, 3],
  product_count: 3,
  render,
};
