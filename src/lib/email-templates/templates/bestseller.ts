import {
  ctaBlock,
  footer,
  header,
  headlineBlock,
  hero,
  htmlClose,
  htmlOpen,
  leadBlock,
  productMetaBlock,
} from "./shared";
import type { TemplateRenderContext } from "../types";

export function renderBestseller(ctx: TemplateRenderContext): string {
  return [
    htmlOpen({ subject: ctx.copy.subject, preview: ctx.copy.lead }),
    header(),
    hero({ image_url: ctx.product.image_url, alt: ctx.product.name, badge: "TOP 1 DA SEMANA" }),
    headlineBlock(ctx.copy.headline),
    leadBlock(ctx.copy.lead),
    productMetaBlock({ name: ctx.product.name, price: ctx.product.price, old_price: ctx.product.old_price }),
    ctaBlock({ text: ctx.copy.cta_text, url: ctx.copy.cta_url }),
    footer(),
    htmlClose(),
  ].join("\n");
}
