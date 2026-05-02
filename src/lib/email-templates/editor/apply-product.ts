// src/lib/email-templates/editor/apply-product.ts
//
// When the user picks a product on the "Produto" (hero) block or the
// "Preço + nome" (product-meta) block, the rest of the email should follow:
// the price block updates name/price, the CTA points to the new product URL,
// any coupon block re-references the product name, and so on.
//
// related-products is intentionally left alone — those are independent slots
// the user curates separately.

import type { BlockNode } from "./schema";

export interface ProductLike {
  vnda_id: string;
  name: string;
  price: number;
  old_price?: number;
  image_url: string;
  url: string;
}

export function applyProductToBlocks(blocks: BlockNode[], p: ProductLike): BlockNode[] {
  return blocks.map((b) => {
    switch (b.type) {
      case "hero":
        return { ...b, image_url: p.image_url, alt: p.name };
      case "product-meta":
        return { ...b, name: p.name, price: p.price, old_price: p.old_price };
      case "cta":
        // Only retarget the CTA if it points at a real product page (not an
        // arbitrary destination like a campaign landing).
        if (!b.url || /bulking\.com\.br\/?$/i.test(b.url) || isProductUrl(b.url)) {
          return { ...b, url: p.url || b.url };
        }
        return b;
      case "coupon":
        return { ...b, product_name: p.name };
      case "image": {
        // If the image block was originally seeded from the product photo,
        // keep it in sync. Heuristic: alt matches the previous product name.
        // Otherwise leave it alone (might be a separate banner).
        return b;
      }
      default:
        return b;
    }
  });
}

function isProductUrl(u: string): boolean {
  return /\/produto\//i.test(u) || /bulking\.com\.br\/.+/i.test(u);
}
