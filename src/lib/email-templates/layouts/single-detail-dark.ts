// src/lib/email-templates/layouts/single-detail-dark.ts
//
// Single-product detail hero. Inspired by the REPRESENT Collared Puffer
// reference: a moody full-bleed product portrait dominates, with the product
// name set in two large lines and a short paragraph anchored bottom-left,
// brand wordmark below. Dark surface, white type, no related grid (the
// product carries the entire email).
//
// Reference: public/Hero Emails/download_9.jfif

import {
  escapeHtml,
  htmlClose,
  htmlOpen,
  TOKENS,
  topCountdownBlock,
} from "../templates/shared";
import type { TemplateRenderContext } from "../types";
import type { LayoutDef } from "./types";
import { SLOT_HOOK_DEFAULT } from "./_meta";

const DARK_BG = "#000000";
const DARK_FG = "#FFFFFF";
const DARK_MUTED = "#A8A8A8";
const DARK_BORDER = "#1F1F1F";

/**
 * Splits a product name into two visual lines so the dominant hero composition
 * reads with a clean line break. The first line gets the first half (rounded
 * to the closest space), the rest goes to line two.
 */
function splitTwoLines(name: string): [string, string] {
  const trimmed = name.trim();
  if (trimmed.length < 14) return [trimmed, ""];
  const mid = Math.floor(trimmed.length / 2);
  // find nearest space
  let i = mid;
  while (i > 0 && trimmed[i] !== " ") i--;
  if (i === 0) return [trimmed, ""];
  return [trimmed.slice(0, i), trimmed.slice(i + 1)];
}

function render(ctx: TemplateRenderContext): string {
  const { slot, copy, product, coupon } = ctx;
  const hook = ctx.hook ?? SLOT_HOOK_DEFAULT[slot];
  const [line1, line2] = splitTwoLines(product.name);

  const blocks: string[] = [
    htmlOpen({ subject: copy.subject, preview: copy.lead }).replace(
      `background:${TOKENS.bg};`,
      `background:${DARK_BG};`
    ),
    `
<tr><td align="center" class="pad-xl" style="padding:48px 32px 36px;background:${DARK_BG};border-bottom:1px solid ${DARK_BORDER};">
  <a href="https://www.bulking.com.br" target="_blank" style="text-decoration:none;color:${DARK_FG};">
    <span style="display:inline-block;font-family:${TOKENS.fontHead};font-weight:500;font-size:18px;letter-spacing:0.32em;color:${DARK_FG};text-transform:uppercase;">BULKING</span>
  </a>
</td></tr>`,
  ];

  if (slot === 2 && coupon) {
    blocks.push(
      topCountdownBlock({
        countdown_url: coupon.countdown_url,
        expires_at: coupon.expires_at,
      })
    );
  }

  // Eyebrow above the hero.
  blocks.push(`
<tr><td align="center" class="pad-l" style="padding:36px 32px 4px;background:${DARK_BG};">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${DARK_MUTED};text-transform:uppercase;">${escapeHtml(hook)}</div>
</td></tr>`);

  // Full-bleed product hero.
  blocks.push(`
<tr><td style="padding:24px 0 0;background:${DARK_BG};">
  <img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}" width="600" height="780" style="width:100%;max-width:600px;height:auto;display:block;" />
</td></tr>`);

  // Two-line product name + paragraph + brand wordmark.
  blocks.push(`
<tr><td align="left" class="pad-xl" style="padding:32px 40px 8px;background:${DARK_BG};">
  <h1 style="margin:0;font-family:${TOKENS.fontHead};font-weight:500;font-size:42px;line-height:1.05;color:${DARK_FG};letter-spacing:-0.01em;text-transform:uppercase;">${escapeHtml(line1)}${line2 ? `<br />${escapeHtml(line2)}` : ""}</h1>
</td></tr>
<tr><td align="left" class="pad-l" style="padding:8px 40px 24px;background:${DARK_BG};">
  <p style="margin:0;font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;line-height:1.7;color:${DARK_MUTED};max-width:520px;">${escapeHtml(copy.lead)}</p>
</td></tr>
<tr><td align="left" class="pad-l" style="padding:0 40px 24px;background:${DARK_BG};">
  <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:13px;letter-spacing:0.32em;color:${DARK_FG};text-transform:uppercase;">BULKING</div>
</td></tr>`);

  // Slot-2 coupon panel (dark variant).
  if (slot === 2 && coupon) {
    blocks.push(`
<tr><td class="pad-l" style="padding:0 40px 24px;background:${DARK_BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${DARK_FG};">
    <tr><td align="center" style="padding:30px 24px;">
      <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${DARK_MUTED};text-transform:uppercase;margin-bottom:14px;">Cupom exclusivo</div>
      <div style="font-family:${TOKENS.fontMono};font-weight:500;font-size:22px;letter-spacing:0.18em;color:${DARK_FG};background:${DARK_BG};padding:16px 26px;display:inline-block;border:1px dashed ${DARK_BORDER};">${escapeHtml(coupon.code)}</div>
      <div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;color:${DARK_MUTED};margin-top:18px;">${coupon.discount_percent}% off na peça</div>
    </td></tr>
  </table>
</td></tr>`);
  }

  // Price + CTA.
  const oldPrice =
    product.old_price && product.old_price > product.price
      ? `<span style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;color:${DARK_MUTED};text-decoration:line-through;margin-right:12px;">R$ ${product.old_price.toFixed(2)}</span>`
      : "";

  blocks.push(`
<tr><td align="left" class="pad-l" style="padding:0 40px 16px;background:${DARK_BG};">
  <div>${oldPrice}<span style="font-family:${TOKENS.fontHead};font-weight:500;font-size:22px;color:${DARK_FG};">R$ ${product.price.toFixed(2)}</span></div>
</td></tr>
<tr><td align="left" class="pad-xl" style="padding:8px 40px 56px;background:${DARK_BG};">
  <a href="${escapeHtml(copy.cta_url)}" target="_blank" style="display:inline-block;background:${DARK_FG};color:${DARK_BG};font-family:${TOKENS.fontHead};font-weight:600;font-size:13px;letter-spacing:0.28em;text-transform:uppercase;text-decoration:none;padding:20px 44px;">${escapeHtml(copy.cta_text)}</a>
</td></tr>`);

  // Dark footer.
  blocks.push(`
<tr><td class="pad-xl" style="padding:48px 40px;background:${DARK_BG};border-top:1px solid ${DARK_BORDER};">
  <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:12px;letter-spacing:0.32em;color:${DARK_FG};text-transform:uppercase;margin-bottom:16px;text-align:center;">Respect the Hustle.</div>
  <div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:12px;color:${DARK_MUTED};line-height:1.8;text-align:center;">
    Bulking · <a href="https://www.bulking.com.br" style="color:${DARK_MUTED};text-decoration:underline;">bulking.com.br</a><br />
    Você está recebendo este email porque é cliente Bulking. <a href="{{UNSUBSCRIBE_URL}}" style="color:${DARK_MUTED};text-decoration:underline;">Descadastrar</a>.
  </div>
</td></tr>`);

  blocks.push(htmlClose());
  return blocks.join("\n");
}

export const singleDetailDarkLayout: LayoutDef = {
  id: "single-detail-dark",
  pattern_name: "Single product detail (dark)",
  reference_image: "download_9.jfif",
  mode: "dark",
  slots: [1, 2, 3],
  product_count: 0,
  render,
};
