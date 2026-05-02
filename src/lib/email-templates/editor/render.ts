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
/**
 * Build the same inline CSS the shared helpers produce, but accept rich
 * HTML for the body so a Tiptap-produced fragment (with its own inline
 * <strong>, <em>, <span style="color/font-size">) can render inside the
 * email's outer table shell without being escaped.
 */
function richHookHtml(html: string, mode: "light" | "dark"): string {
  const c = mode === "dark" ? "#B8B8B8" : TOKENS.textSecondary;
  return `
<tr><td align="center" class="pad-l" style="padding:40px 32px 12px;">
  <div style="font-family:${TOKENS.fontBody};font-size:11px;font-weight:500;color:${c};letter-spacing:0.32em;text-transform:uppercase;">${html}</div>
</td></tr>`;
}

function richHeadlineHtml(html: string, mode: "light" | "dark"): string {
  const c = mode === "dark" ? "#FFFFFF" : TOKENS.text;
  return `
<tr><td class="pad-xl" align="center" style="padding:56px 40px 14px;">
  <h1 class="h1" style="margin:0;font-family:${TOKENS.fontHead};font-size:38px;font-weight:500;color:${c};line-height:1.1;letter-spacing:-0.005em;">${html}</h1>
</td></tr>`;
}

function richLeadHtml(html: string, mode: "light" | "dark"): string {
  const c = mode === "dark" ? "#D8D8D8" : TOKENS.textMuted;
  return `
<tr><td class="pad-l" align="center" style="padding:0 40px 40px;">
  <div class="lead" style="margin:0;font-family:${TOKENS.fontBody};font-size:16px;font-weight:400;color:${c};line-height:1.7;max-width:480px;margin-left:auto;margin-right:auto;">${html}</div>
</td></tr>`;
}

function richTextHtml(html: string, mode: "light" | "dark", align: "left" | "center"): string {
  const c = mode === "dark" ? "#D8D8D8" : TOKENS.textMuted;
  return `
<tr><td class="pad-l" align="${align}" style="padding:0 40px 32px;text-align:${align};">
  <div style="font-family:${TOKENS.fontBody};font-size:15px;font-weight:400;color:${c};line-height:1.7;">${html}</div>
</td></tr>`;
}
import { buildCountdownUrl } from "../countdown";
import type { BlockNode, Draft, LogoConfig, TemplateData } from "./schema";
import { DEFAULT_LOGO } from "./schema";
import { LAYOUTS } from "../layouts";
import type { LayoutId } from "../layouts/types";
import type { TemplateRenderContext, Slot } from "../types";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "https://dash.bulking.com.br";

function renderBlockInner(b: BlockNode, mode: "light" | "dark"): string {
  switch (b.type) {
    case "hero":
      return heroBlock({ image_url: b.image_url, alt: b.alt, badge: b.badge, mode });
    case "headline":
      return b.html
        ? richHeadlineHtml(b.html, mode)
        : headlineBlock(b.text, mode, b.style);
    case "lead":
      return b.html ? richLeadHtml(b.html, mode) : leadBlock(b.text, mode, b.style);
    case "hook":
      return b.html ? richHookHtml(b.html, mode) : hookBlock(b.text, mode, b.style);
    case "cta":
      return mode === "dark"
        ? darkCtaBlock({ text: b.text, url: b.url })
        : ctaBlock({ text: b.text, url: b.url });
    case "product-meta":
      return productMetaBlock({ name: b.name, price: b.price, old_price: b.old_price, mode });
    case "related-products":
      return relatedProductsGrid(b.products, mode);
    case "rating":
      return ratingStarsBlock(b.rating, b.count, mode);
    case "discount-badge":
      return discountBadgeBlock(b.discount_percent, mode);
    case "coupon":
      return couponBlock({
        code: b.code,
        discount_percent: b.discount_percent,
        product_name: b.product_name,
        mode,
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
      const align = b.align ?? "center";
      if (b.html) {
        return richTextHtml(b.html, mode, align);
      }
      const text = b.text ?? "";
      const defaultColor = mode === "dark" ? "#D8D8D8" : TOKENS.textMuted;
      const fs = b.style?.font_size ?? 15;
      const fw = b.style?.font_weight ?? 400;
      const fi = b.style?.italic ? "italic" : "normal";
      const co = b.style?.color ?? defaultColor;
      const paragraphs = text
        .split(/\n{2,}/)
        .map(
          (p) =>
            `<p style="margin:0 0 14px 0;font-family:${TOKENS.fontBody};font-size:${fs}px;font-weight:${fw};font-style:${fi};color:${co};line-height:1.7;">${escapeHtml(p)}</p>`
        )
        .join("");
      return `
<tr><td class="pad-l" align="${align}" style="padding:0 40px 32px;text-align:${align};">
  ${paragraphs}
</td></tr>`;
    }
    case "image": {
      // Locked 3:4 frame, same treatment as the hero — keeps the layout
      // stable regardless of source aspect ratio.
      const bg = mode === "dark" ? DARK.surfaceAlt : TOKENS.bgAlt;
      const img = `<img src="${escapeHtml(b.image_url)}" alt="${escapeHtml(b.alt)}" width="600" height="800" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;object-position:center;display:block;" />`;
      const inner = `<div style="position:relative;width:100%;max-width:600px;padding-top:133.33%;margin:0 auto;background:${bg};overflow:hidden;">${img}</div>`;
      const wrapped = b.href
        ? `<a href="${escapeHtml(b.href)}" target="_blank" style="text-decoration:none;">${inner}</a>`
        : inner;
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

const DEFAULT_LOGO_URL =
  "https://cdn.vnda.com.br/bulking/2023/12/01/18_12_2_290_logobulkingsite.svg?v=1701465320";

function renderLogo(logo: LogoConfig, mode: "light" | "dark", editorMode: boolean): string {
  const w = Math.max(60, Math.min(300, logo.width));
  const border = mode === "dark" ? DARK.border : TOKENS.border;
  const bg = mode === "dark" ? DARK.bg : "transparent";
  const tagAttr = editorMode ? ` data-block-id="__logo__"` : "";
  const fg = mode === "dark" ? DARK.fg : TOKENS.text;

  // Dark mode + default Bulking SVG (solid black ink) would disappear on the
  // dark canvas. Fall back to a text mark sized roughly equivalent to the
  // image width. The user can still override with their own image URL.
  const usingDefaultBlackSvg = !logo.image_url || logo.image_url === DEFAULT_LOGO_URL;
  const inner =
    mode === "dark" && usingDefaultBlackSvg
      ? `<span style="display:inline-block;font-family:'Kanit','Inter',Arial,sans-serif;font-weight:500;font-size:${Math.round(w * 0.13)}px;letter-spacing:0.32em;color:${fg};text-transform:uppercase;">BULKING</span>`
      : `<img src="${escapeHtml(logo.image_url)}" alt="${escapeHtml(logo.alt)}" width="${w}" style="display:inline-block;width:${w}px;height:auto;max-width:${w}px;border:0;outline:none;" />`;

  return `
<tr${tagAttr}><td align="center" class="pad-xl" style="padding:48px 32px 36px;background:${bg};border-bottom:1px solid ${border};">
  <a href="https://www.bulking.com.br" target="_blank" style="text-decoration:none;color:${fg};">
    ${inner}
  </a>
</td></tr>`;
}

function buildEditorScript(mode: "light" | "dark"): string {
  const hover = mode === "dark" ? "1px dashed rgba(255,255,255,.45)" : "1px dashed rgba(0,0,0,.35)";
  const selected = mode === "dark" ? "2px solid #60a5fa" : "2px solid #2563eb";
  return `<script>(function(){
  var sel=null;
  function clear(){if(sel){sel.style.outline='';sel.style.outlineOffset='';sel=null;}}
  document.addEventListener('mouseover',function(e){
    var t=e.target&&e.target.closest&&e.target.closest('[data-block-id]');
    if(!t||t===sel)return;
    var prev=document.querySelector('.__hover');
    if(prev){prev.classList.remove('__hover');prev.style.outline='';prev.style.outlineOffset='';}
    t.classList.add('__hover');
    t.style.outline='${hover}';
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
    t.style.outline='${selected}';
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
    nodes.forEach(function(n){n.style.outline='${selected}';n.style.outlineOffset='-2px';});
  });
})();</script>`;
}

export interface RenderOpts {
  editorMode?: boolean;
}

/** Build a TemplateRenderContext from a draft's template_data + meta so we
 *  can call the original layout's render() function. We tag every <tr> with
 *  data-block-id when editorMode so the click-to-edit overlay still works. */
function buildTemplateCtx(
  draft: Draft,
  td: TemplateData,
  slot: Slot
): TemplateRenderContext {
  const expiresDate = td.coupon?.expires_at ? new Date(td.coupon.expires_at) : undefined;
  return {
    slot,
    product: td.product,
    related_products: td.related,
    copy: {
      subject: td.copy.subject || draft.meta.subject,
      headline: td.copy.headline,
      lead: td.copy.lead,
      cta_text: td.copy.cta_text,
      cta_url: td.copy.cta_url,
    },
    coupon: td.coupon && expiresDate
      ? {
          code: td.coupon.code,
          discount_percent: td.coupon.discount_percent,
          expires_at: expiresDate,
          countdown_url: "", // computed downstream by topCountdownBlock if needed
        }
      : undefined,
    workspace: { name: "Bulking" },
    hook: td.copy.hook,
  };
}

function inferSlotFromCopy(td: TemplateData): Slot {
  // Heuristic: coupon present → slot 2 (slowmoving / last chance).
  // Otherwise default to slot 1. Layouts only really care about slot to pick
  // a coupon path; the editor doesn't expose slot to the user.
  if (td.coupon) return 2;
  return 1;
}

export function renderDraft(draft: Draft, opts: RenderOpts = {}): string {
  const { meta, blocks } = draft;
  const editorMode = !!opts.editorMode;

  // Template mode: render through the picked layout's render() so we
  // preserve its visual identity (split typography, side-by-side reviews,
  // 3x3 grid, etc.) — none of which can be reproduced in the block model.
  if (
    meta.render_mode === "template" &&
    draft.layout_id &&
    meta.template_data &&
    LAYOUTS[draft.layout_id as LayoutId]
  ) {
    const layout = LAYOUTS[draft.layout_id as LayoutId];
    const slot = inferSlotFromCopy(meta.template_data);
    const ctx = buildTemplateCtx(draft, meta.template_data, slot);
    let html = layout.render(ctx);
    if (editorMode) {
      // Tag the body root <tr>s coarsely so the click-overlay can map at
      // least block-level selections to edit fields. Cheap regex tag of every
      // <tr> with a synthetic id; the editor treats __template__ as the
      // signal to open the template-mode form.
      html = html.replace(/<tr(\s|>)/g, `<tr data-block-id="__template__"$1`);
      html = html.replace("</body>", `${buildEditorScript(meta.mode)}</body>`);
    }
    return html;
  }

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

  const script = editorMode ? buildEditorScript(meta.mode) : "";
  const closeWithScript = script ? close.replace("</body>", `${script}</body>`) : close;
  return `${open}\n${head}\n${body}\n${foot}\n${closeWithScript}`;
}
