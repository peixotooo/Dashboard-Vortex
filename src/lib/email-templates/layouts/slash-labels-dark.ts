// src/lib/email-templates/layouts/slash-labels-dark.ts
//
// Editorial dark-mode layout. Inspired by the Asics x BEAMS reference: a
// full-bleed product hero with caption labels separated by a slash floating
// over the negative space. Black surface, white type. Heavy whitespace,
// minimal CTA.
//
// Reference: public/Hero Emails/download_10.jfif

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
  const { slot, copy, product, coupon } = ctx;
  const hook = ctx.hook ?? SLOT_HOOK_DEFAULT[slot];

  const slashLeft = SLASH_LEFT[slot];
  const slashRight = SLASH_RIGHT[slot];
  const date = dateLabel();

  const blocks: string[] = [
    // Wrap entire body in dark surface.
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

  // Hero with slash labels overlaid on rows above and below.
  blocks.push(`
<tr><td style="padding:40px 32px 12px;background:${DARK_BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="left" valign="top" style="padding:0;">
        <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.28em;color:${DARK_FG};text-transform:uppercase;">${escapeHtml(slashLeft)}</div>
      </td>
      <td align="right" valign="top" style="padding:0;">
        <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.28em;color:${DARK_MUTED};text-transform:uppercase;">${escapeHtml(date)} / DELIVERY</div>
      </td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:0;background:${DARK_BG};">
  <img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}" width="600" height="780" style="width:100%;max-width:600px;height:auto;display:block;background:${DARK_BG};" />
</td></tr>
<tr><td style="padding:12px 32px 32px;background:${DARK_BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="left" valign="top" style="padding:0;">
        <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.28em;color:${DARK_FG};text-transform:uppercase;">FALL / WINTER ${new Date().getFullYear()}</div>
      </td>
      <td align="right" valign="top" style="padding:0;">
        <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.28em;color:${DARK_MUTED};text-transform:uppercase;">${escapeHtml(slashRight)}</div>
      </td>
    </tr>
  </table>
</td></tr>`);

  // Quiet eyebrow + headline below the hero.
  blocks.push(`
<tr><td align="center" class="pad-l" style="padding:32px 40px 4px;background:${DARK_BG};">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${DARK_MUTED};text-transform:uppercase;">${escapeHtml(hook)}</div>
</td></tr>
<tr><td align="center" class="pad-xl" style="padding:14px 40px 16px;background:${DARK_BG};">
  <h1 class="h1" style="margin:0;font-family:${TOKENS.fontHead};font-weight:500;font-size:36px;line-height:1.1;color:${DARK_FG};letter-spacing:-0.005em;">${escapeHtml(copy.headline)}</h1>
</td></tr>
<tr><td align="center" class="pad-l" style="padding:0 40px 28px;background:${DARK_BG};">
  <p style="margin:0;font-family:${TOKENS.fontBody};font-weight:400;font-size:15px;line-height:1.7;color:${DARK_MUTED};max-width:460px;margin:0 auto;">${escapeHtml(copy.lead)}</p>
</td></tr>`);

  // Slot-2 coupon. Inverted version of the standard couponBlock.
  if (slot === 2 && coupon) {
    blocks.push(`
<tr><td class="pad-l" style="padding:0 40px 28px;background:${DARK_BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${DARK_FG};">
    <tr><td align="center" style="padding:30px 24px;">
      <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${DARK_MUTED};text-transform:uppercase;margin-bottom:14px;">Cupom exclusivo</div>
      <div style="font-family:${TOKENS.fontMono};font-weight:500;font-size:22px;letter-spacing:0.18em;color:${DARK_FG};background:${DARK_BG};padding:16px 26px;display:inline-block;border:1px dashed ${DARK_BORDER};">${escapeHtml(coupon.code)}</div>
      <div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;color:${DARK_MUTED};margin-top:18px;">${coupon.discount_percent}% off em ${escapeHtml(product.name)}</div>
    </td></tr>
  </table>
</td></tr>`);
  }

  // Price line + CTA.
  const oldPrice =
    product.old_price && product.old_price > product.price
      ? `<span style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;color:${DARK_MUTED};text-decoration:line-through;margin-right:12px;">R$ ${product.old_price.toFixed(2)}</span>`
      : "";

  blocks.push(`
<tr><td align="center" class="pad-l" style="padding:0 40px 24px;background:${DARK_BG};">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:14px;color:${DARK_MUTED};margin-bottom:8px;letter-spacing:0.04em;">${escapeHtml(product.name)}</div>
  <div>${oldPrice}<span style="font-family:${TOKENS.fontHead};font-weight:500;font-size:22px;color:${DARK_FG};">R$ ${product.price.toFixed(2)}</span></div>
</td></tr>
<tr><td align="center" class="pad-xl" style="padding:8px 40px 56px;background:${DARK_BG};">
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

export const slashLabelsDarkLayout: LayoutDef = {
  id: "slash-labels-dark",
  pattern_name: "Slash labels (dark editorial)",
  reference_image: "download_10.jfif",
  mode: "dark",
  slots: [1, 2, 3],
  product_count: 0,
  render,
};
