// src/lib/email-templates/editor/render.ts
//
// Renders a Draft (block schema) into the final email HTML by stitching the
// shared.ts primitives. Everything stays email-safe (table-based, inline
// styles) — the editor never produces free-positioned divs.
//
// When `editorMode: true` is passed, every top-level block is wrapped with
// data-block-id, and a small click-handler script is appended to the body
// that posts the clicked block id back to the parent window. This lets the
// editor open the inspector for whatever the user clicks directly inside
// the live preview, instead of forcing them through a side outline.

import {
  TOKENS,
  DARK,
  escapeHtml,
  htmlOpen,
  htmlClose,
  darkOpen,
  darkClose,
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
import type { BlockNode, Draft, LogoConfig } from "./schema";
import { DEFAULT_LOGO } from "./schema";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "https://dash.bulking.com.br";

function renderBlockInner(b: BlockNode, mode: "light" | "dark"): string {
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

/**
 * Stamp the first <tr ...> in `html` with data-block-id="<id>" so the editor
 * can map clicks back to the block. Hero produces two top-level <tr>s
 * (badge + image); we tag both so clicking either selects the hero.
 */
function tagBlockHtml(html: string, blockId: string, editorMode: boolean): string {
  if (!editorMode) return html;
  return html.replace(/<tr(\s|>)/g, `<tr data-block-id="${blockId}"$1`);
}

function renderLogo(logo: LogoConfig, mode: "light" | "dark", editorMode: boolean): string {
  const w = Math.max(60, Math.min(300, logo.width));
  const border = mode === "dark" ? DARK.border : TOKENS.border;
  const bg = mode === "dark" ? DARK.bg : "transparent";
  const tagAttr = editorMode ? ` data-block-id="__logo__"` : "";
  return `
<tr${tagAttr}><td align="center" class="pad-xl" style="padding:48px 32px 36px;background:${bg};border-bottom:1px solid ${border};">
  <a href="https://www.bulking.com.br" target="_blank" style="text-decoration:none;color:${mode === "dark" ? DARK.fg : TOKENS.text};">
    <img src="${escapeHtml(logo.image_url)}" alt="${escapeHtml(logo.alt)}" width="${w}" style="display:inline-block;width:${w}px;height:auto;max-width:${w}px;border:0;outline:none;" />
  </a>
</td></tr>`;
}

const EDITOR_CLICK_SCRIPT = `<script>(function(){
  var sel=null;
  function clear(){if(sel){sel.style.outline='';sel.style.outlineOffset='';sel=null;}}
  document.addEventListener('mouseover',function(e){
    var t=e.target&&e.target.closest&&e.target.closest('[data-block-id]');
    if(!t||t===sel)return;
    var prev=document.querySelector('.__hover');
    if(prev){prev.classList.remove('__hover');prev.style.outline='';prev.style.outlineOffset='';}
    t.classList.add('__hover');
    t.style.outline='1px dashed rgba(0,0,0,.35)';
    t.style.outlineOffset='-1px';
  },true);
  document.addEventListener('mouseout',function(e){
    var t=e.target&&e.target.closest&&e.target.closest('[data-block-id]');
    if(!t)return;
    if(t!==sel){t.classList.remove('__hover');t.style.outline='';t.style.outlineOffset='';}
  },true);
  document.addEventListener('click',function(e){
    var t=e.target&&e.target.closest&&e.target.closest('[data-block-id]');
    if(!t)return;
    e.preventDefault();
    e.stopPropagation();
    clear();
    sel=t;
    t.style.outline='2px solid #2563eb';
    t.style.outlineOffset='-2px';
    try{parent.postMessage({type:'block:select',id:t.getAttribute('data-block-id')},'*');}catch(err){}
  },true);
  window.addEventListener('message',function(e){
    if(!e.data||e.data.type!=='block:set-selected')return;
    clear();
    var id=e.data.id;
    if(!id)return;
    var nodes=document.querySelectorAll('[data-block-id="'+id+'"]');
    if(nodes.length===0)return;
    sel=nodes[0];
    nodes.forEach(function(n){n.style.outline='2px solid #2563eb';n.style.outlineOffset='-2px';});
  });
})();</script>`;

export interface RenderOpts {
  editorMode?: boolean;
}

export function renderDraft(draft: Draft, opts: RenderOpts = {}): string {
  const { meta, blocks } = draft;
  const editorMode = !!opts.editorMode;

  const open =
    meta.mode === "dark"
      ? darkOpen({ subject: meta.subject, preview: meta.preview })
      : htmlOpen({ subject: meta.subject, preview: meta.preview });
  const close = meta.mode === "dark" ? darkClose() : htmlClose();
  const foot = meta.mode === "dark" ? darkFooter() : lightFooter();

  // Logo: undefined -> default (back-compat), null -> hide, object -> use it.
  const logo = meta.logo === undefined ? DEFAULT_LOGO : meta.logo;
  const head = logo ? renderLogo(logo, meta.mode, editorMode) : "";

  const body = blocks
    .map((b) => tagBlockHtml(renderBlockInner(b, meta.mode), b.id, editorMode))
    .join("\n");

  const script = editorMode ? EDITOR_CLICK_SCRIPT : "";
  const closeWithScript = script ? close.replace("</body>", `${script}</body>`) : close;
  return `${open}\n${head}\n${body}\n${foot}\n${closeWithScript}`;
}
