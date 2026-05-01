// src/lib/email-templates/layouts/classic.ts
//
// Polished default layout. Single-column editorial composition. Routes by
// ctx.slot to pick badge text and decide whether to render the coupon block
// (slot 2 only). This is the existing in-production layout, exposed as a
// LayoutDef so the rotation engine can pick it alongside the new variants.

import {
  couponBlock,
  ctaBlock,
  discountBadgeBlock,
  footer,
  header,
  headlineBlock,
  hero,
  hookBlock,
  htmlClose,
  htmlOpen,
  leadBlock,
  productMetaBlock,
  ratingStarsBlock,
  relatedProductsGrid,
  topCountdownBlock,
} from "../templates/shared";
import type { TemplateRenderContext } from "../types";
import type { LayoutDef } from "./types";
import { SLOT_BADGE, SLOT_HOOK_DEFAULT } from "./_meta";

function render(ctx: TemplateRenderContext): string {
  const { slot, copy, product, coupon, related_products } = ctx;
  const hook = ctx.hook ?? SLOT_HOOK_DEFAULT[slot];
  const blocks: string[] = [
    htmlOpen({ subject: copy.subject, preview: copy.lead }),
    header(),
  ];

  // Slot 2 puts the animated countdown right under the logo.
  if (slot === 2 && coupon) {
    blocks.push(
      topCountdownBlock({
        countdown_url: coupon.countdown_url,
        expires_at: coupon.expires_at,
      })
    );
  }

  blocks.push(hookBlock(hook));

  if (slot === 2 && coupon) {
    blocks.push(discountBadgeBlock(coupon.discount_percent));
  }

  blocks.push(
    hero({ image_url: product.image_url, alt: product.name, badge: SLOT_BADGE[slot] }),
    headlineBlock(copy.headline),
    ratingStarsBlock(5),
    leadBlock(copy.lead)
  );

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

export const classicLayout: LayoutDef = {
  id: "classic",
  pattern_name: "Classic editorial",
  reference_image: "in-house",
  mode: "light",
  slots: [1, 2, 3],
  product_count: 3,
  render,
};
