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
} from "./shared";
import type { TemplateRenderContext } from "../types";

export function renderSlowmoving(ctx: TemplateRenderContext): string {
  if (!ctx.coupon) {
    throw new Error("renderSlowmoving requires ctx.coupon");
  }
  return [
    htmlOpen({ subject: ctx.copy.subject, preview: ctx.copy.lead }),
    header(),
    hookBlock(ctx.hook ?? "Estoque acabando"),
    discountBadgeBlock(ctx.coupon.discount_percent),
    hero({ image_url: ctx.product.image_url, alt: ctx.product.name, badge: "ÚLTIMAS PEÇAS" }),
    headlineBlock(ctx.copy.headline),
    ratingStarsBlock(5),
    leadBlock(ctx.copy.lead),
    couponBlock({
      code: ctx.coupon.code,
      discount_percent: ctx.coupon.discount_percent,
      product_name: ctx.product.name,
      countdown_url: ctx.coupon.countdown_url,
    }),
    productMetaBlock({ name: ctx.product.name, price: ctx.product.price, old_price: ctx.product.old_price }),
    ctaBlock({ text: ctx.copy.cta_text, url: ctx.copy.cta_url }),
    relatedProductsGrid(ctx.related_products),
    footer(),
    htmlClose(),
  ].join("\n");
}
