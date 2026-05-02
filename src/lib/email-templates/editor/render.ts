// src/lib/email-templates/editor/render.ts
//
// Renders a Draft (block schema) into the final email HTML by stitching the
// shared.ts primitives. Everything stays email-safe (table-based, inline
// styles) — the editor never produces free-positioned divs.

import {
  TOKENS,
  DARK,
  escapeHtml,
  htmlOpen,
  htmlClose,
  darkOpen,
  darkClose,
  header as lightHeader,
  darkHeader,
  footer as lightFooter,
  darkFooter,
  spacer,
  hookBlock,
  hero as heroBlock,
  headlineBlock,
  leadBlock,
  ctaBlock,
  darkCtaBlock,
  productMetaBlock,
  ratingStarsBlock,
  discountBadgeBlock,
  couponBlock,
  topCountdownBlock,
  relatedProductsGrid,
} from "../templates/shared";
import { buildCountdownUrl } from "../countdown";
import type { BlockNode, Draft } from "./schema";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "https://dash.bulking.com.br";

function renderBlock(b: BlockNode, mode: "light" | "dark"): string {
  switch (b.type) {
    case "hero":
      return heroBlock({ image_url: b.image_url, alt: b.alt, badge: b.badge });
    case "headline":
      return headlineBlock(b.text);
    case "lead":
      return leadBlock(b.text);
    case "hook":
      return hookBlock(b.text);
    case "cta":
      return mode === "dark"
        ? darkCtaBlock({ text: b.text, url: b.url })
        : ctaBlock({ text: b.text, url: b.url });
    case "product-meta":
      return productMetaBlock({ name: b.name, price: b.price, old_price: b.old_price });
    case "related-products":
      return relatedProductsGrid(b.products);
    case "rating":
      return ratingStarsBlock(b.rating, b.count);
    case "discount-badge":
      return discountBadgeBlock(b.discount_percent);
    case "coupon":
      return couponBlock({
        code: b.code,
        discount_percent: b.discount_percent,
        product_name: b.product_name,
      });
    case "countdown": {
      let url = "";
      try {
        url = buildCountdownUrl({
          base_url: APP_BASE_URL,
          expires_at: new Date(b.expires_at),
        });
      } catch {
        url = "";
      }
      return topCountdownBlock({
        countdown_url: url,
        expires_at: new Date(b.expires_at),
      });
    }
    case "spacer":
      return spacer(b.height);
    case "divider": {
      const color = mode === "dark" ? DARK.border : TOKENS.border;
      return `
<tr><td class="pad-l" style="padding:8px 40px;">
  <div style="height:1px;background:${color};line-height:1px;font-size:0;">&nbsp;</div>
</td></tr>`;
    }
    case "rich-text": {
      const text = b.text ?? "";
      const align = b.align ?? "center";
      const color = mode === "dark" ? DARK.muted : TOKENS.textMuted;
      const paragraphs = text
        .split(/\n{2,}/)
        .map(
          (p) =>
            `<p style="margin:0 0 14px 0;font-family:${TOKENS.fontBody};font-weight:400;font-size:15px;line-height:1.7;color:${color};">${escapeHtml(p)}</p>`
        )
        .join("");
      return `
<tr><td class="pad-l" align="${align}" style="padding:0 40px 32px;text-align:${align};">
  ${paragraphs}
</td></tr>`;
    }
    case "image": {
      const img = `<img src="${escapeHtml(b.image_url)}" alt="${escapeHtml(b.alt)}" width="600" style="width:100%;max-width:600px;height:auto;display:block;" />`;
      const wrapped = b.href
        ? `<a href="${escapeHtml(b.href)}" target="_blank" style="text-decoration:none;">${img}</a>`
        : img;
      return `
<tr><td style="padding:0;">${wrapped}</td></tr>`;
    }
  }
}

export function renderDraft(draft: Draft): string {
  const { meta, blocks } = draft;
  const open =
    meta.mode === "dark"
      ? darkOpen({ subject: meta.subject, preview: meta.preview })
      : htmlOpen({ subject: meta.subject, preview: meta.preview });
  const close = meta.mode === "dark" ? darkClose() : htmlClose();
  const head = meta.mode === "dark" ? darkHeader() : lightHeader();
  const foot = meta.mode === "dark" ? darkFooter() : lightFooter();

  const body = blocks.map((b) => renderBlock(b, meta.mode)).join("\n");
  return `${open}\n${head}\n${body}\n${foot}\n${close}`;
}
