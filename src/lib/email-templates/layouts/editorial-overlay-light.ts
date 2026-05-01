// src/lib/email-templates/layouts/editorial-overlay-light.ts
//
// Editorial overlay. Inspired by the Black Friday Email Templates reference:
// a massive two-line wordmark headline punched around the hero photo. The
// product image sits between the two giant words, visually braiding the
// product into the headline. Light surface, monochrome.
//
// Reference: public/Hero Emails/Black Friday Email Design _ Email Newsletter Design.jfif

import {
  ctaBlock,
  escapeHtml,
  footer,
  header,
  htmlClose,
  htmlOpen,
  productMetaBlock,
  ratingStarsBlock,
  relatedProductsGrid,
  TOKENS,
  topCountdownBlock,
  couponBlock,
  discountBadgeBlock,
} from "../templates/shared";
import type { TemplateRenderContext } from "../types";
import type { LayoutDef } from "./types";
import { SLOT_HOOK_DEFAULT, SLOT_SPLIT_HEADLINE } from "./_meta";

function splitOverlay(args: {
  topWord: string;
  bottomWord: string;
  image_url: string;
  alt: string;
  eyebrow: string;
}): string {
  return `
<tr><td align="center" class="pad-l" style="padding:24px 32px 4px;">
  <div style="font-family:${TOKENS.fontBody};font-weight:500;font-size:11px;letter-spacing:0.32em;color:${TOKENS.textSecondary};text-transform:uppercase;">${escapeHtml(args.eyebrow)}</div>
</td></tr>
<tr><td align="left" style="padding:0 0 0 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="left" style="padding:24px 40px 0;">
      <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:84px;line-height:0.95;color:${TOKENS.text};letter-spacing:-0.02em;text-transform:uppercase;">${escapeHtml(args.topWord)}</div>
    </td></tr>
    <tr><td style="padding:8px 0 0;">
      <img src="${escapeHtml(args.image_url)}" alt="${escapeHtml(args.alt)}" width="600" height="600" style="width:100%;max-width:600px;height:auto;display:block;" />
    </td></tr>
    <tr><td align="right" style="padding:0 40px 16px;">
      <div style="font-family:${TOKENS.fontHead};font-weight:500;font-size:84px;line-height:0.95;color:${TOKENS.text};letter-spacing:-0.02em;text-transform:uppercase;">${escapeHtml(args.bottomWord)}</div>
    </td></tr>
  </table>
</td></tr>`;
}

function render(ctx: TemplateRenderContext): string {
  const { slot, copy, product, coupon, related_products } = ctx;
  const hook = ctx.hook ?? SLOT_HOOK_DEFAULT[slot];
  const [topWord, bottomWord] = SLOT_SPLIT_HEADLINE[slot];

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

  blocks.push(
    splitOverlay({
      topWord,
      bottomWord,
      image_url: ctx.hero_url ?? product.image_url,
      alt: product.name,
      eyebrow: hook,
    })
  );

  if (slot === 2 && coupon) {
    blocks.push(discountBadgeBlock(coupon.discount_percent));
  }

  // Quiet 2-line subhead anchored under the wordmark
  blocks.push(`
<tr><td align="center" class="pad-l" style="padding:24px 40px 8px;">
  <div style="font-family:${TOKENS.fontBody};font-weight:400;font-size:15px;line-height:1.7;color:${TOKENS.textMuted};max-width:440px;margin:0 auto;">${escapeHtml(copy.lead)}</div>
</td></tr>`);

  blocks.push(ratingStarsBlock(5));

  if (slot === 2 && coupon) {
    blocks.push(
      couponBlock({
        code: coupon.code,
        discount_percent: coupon.discount_percent,
        product_name: product.name,
      })
    );
  }

  blocks.push(
    productMetaBlock({
      name: product.name,
      price: product.price,
      old_price: product.old_price,
    }),
    ctaBlock({ text: copy.cta_text, url: copy.cta_url }),
    relatedProductsGrid(related_products),
    footer(),
    htmlClose()
  );

  return blocks.join("\n");
}

export const editorialOverlayLightLayout: LayoutDef = {
  id: "editorial-overlay-light",
  pattern_name: "Editorial overlay (split headline)",
  reference_image: "Black Friday Email Design _ Email Newsletter Design.jfif",
  mode: "light",
  slots: [1, 2, 3],
  product_count: 3,
  render,
};
