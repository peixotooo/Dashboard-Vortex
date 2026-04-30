import {
  ctaBlock,
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

export function renderNewarrival(ctx: TemplateRenderContext): string {
  return [
    htmlOpen({ subject: ctx.copy.subject, preview: ctx.copy.lead }),
    header(),
    hookBlock(ctx.hook ?? "Acabou de chegar"),
    hero({ image_url: ctx.product.image_url, alt: ctx.product.name, badge: "ACABOU DE CHEGAR" }),
    headlineBlock(ctx.copy.headline),
    ratingStarsBlock(5),
    leadBlock(ctx.copy.lead),
    productMetaBlock({ name: ctx.product.name, price: ctx.product.price, old_price: ctx.product.old_price }),
    ctaBlock({ text: ctx.copy.cta_text, url: ctx.copy.cta_url }),
    relatedProductsGrid(ctx.related_products),
    footer(),
    htmlClose(),
  ].join("\n");
}
