// src/lib/email-templates/editor/presets.ts
//
// Each layout family (and slot context) has a corresponding sequence of
// blocks the editor will seed with when the user clicks "Usar template" in
// the library. The presets pull defaults from a sample product so the canvas
// renders something believable on first paint. The user is then free to add,
// remove, reorder, edit any block.

import type { Slot, ProductSnapshot } from "../types";
import type { BlockNode, Draft, EmailMode } from "./schema";
import { newId } from "./schema";

const SLOT_BADGE: Record<Slot, string> = {
  1: "TOP 1 DA SEMANA",
  2: "ÚLTIMA CHANCE",
  3: "NOVO DROP",
};

const SLOT_HOOK: Record<Slot, string> = {
  1: "O top 1 da semana",
  2: "Estoque acabando",
  3: "Acabou de chegar",
};

const SLOT_HEADLINE: Record<Slot, string> = {
  1: "Top 1 e dá pra ver por quê.",
  2: "Última chance pra essa.",
  3: "Acabou de chegar.",
};

const SLOT_LEAD: Record<Slot, string> = {
  1: "Caimento pra quem treina, design feito pra durar. Quem treina escolheu essa essa semana.",
  2: "Estoque acabando. Use o cupom abaixo pra levar com 10% off.",
  3: "Acabou de chegar na grade. Mesma intenção de sempre: design autoral, caimento pensado.",
};

const SLOT_CTA: Record<Slot, string> = {
  1: "Ver na loja",
  2: "Aproveitar agora",
  3: "Conferir lançamento",
};

interface PresetCtx {
  slot: Slot;
  primary: ProductSnapshot;
  related: ProductSnapshot[];
  mode: EmailMode;
  /** When slot===2 the coupon block + countdown are appended */
  coupon?: { code: string; discount_percent: number; expires_at: Date };
}

function blocksForClassic(ctx: PresetCtx): BlockNode[] {
  const out: BlockNode[] = [];

  if (ctx.coupon) {
    out.push({
      id: newId(),
      type: "countdown",
      expires_at: ctx.coupon.expires_at.toISOString(),
    });
  }

  out.push({ id: newId(), type: "hook", text: SLOT_HOOK[ctx.slot] });

  if (ctx.coupon) {
    out.push({ id: newId(), type: "discount-badge", discount_percent: ctx.coupon.discount_percent });
  }

  out.push(
    {
      id: newId(),
      type: "hero",
      image_url: ctx.primary.image_url,
      alt: ctx.primary.name,
      badge: SLOT_BADGE[ctx.slot],
    },
    { id: newId(), type: "headline", text: SLOT_HEADLINE[ctx.slot], align: "center" },
    { id: newId(), type: "rating", rating: 5 },
    { id: newId(), type: "lead", text: SLOT_LEAD[ctx.slot], align: "center" }
  );

  if (ctx.coupon) {
    out.push({
      id: newId(),
      type: "coupon",
      code: ctx.coupon.code,
      discount_percent: ctx.coupon.discount_percent,
      product_name: ctx.primary.name,
    });
  }

  out.push(
    {
      id: newId(),
      type: "product-meta",
      name: ctx.primary.name,
      price: ctx.primary.price,
      old_price: ctx.primary.old_price,
    },
    { id: newId(), type: "cta", text: SLOT_CTA[ctx.slot], url: ctx.primary.url }
  );

  if (ctx.related.length > 0) {
    out.push({
      id: newId(),
      type: "related-products",
      products: ctx.related.map((p) => ({
        name: p.name,
        price: p.price,
        old_price: p.old_price,
        image_url: p.image_url,
        url: p.url,
      })),
    });
  }

  return out;
}

function blocksForSingleDetail(ctx: PresetCtx): BlockNode[] {
  const out: BlockNode[] = [];
  out.push(
    { id: newId(), type: "hook", text: SLOT_HOOK[ctx.slot] },
    {
      id: newId(),
      type: "hero",
      image_url: ctx.primary.image_url,
      alt: ctx.primary.name,
      badge: SLOT_BADGE[ctx.slot],
    },
    { id: newId(), type: "headline", text: SLOT_HEADLINE[ctx.slot], align: "center" },
    { id: newId(), type: "lead", text: SLOT_LEAD[ctx.slot], align: "center" },
    { id: newId(), type: "spacer", height: 24 },
    {
      id: newId(),
      type: "rich-text",
      text: ctx.primary.description ?? "Detalhes técnicos do produto vão aqui.",
      align: "center",
    },
    {
      id: newId(),
      type: "product-meta",
      name: ctx.primary.name,
      price: ctx.primary.price,
      old_price: ctx.primary.old_price,
    },
    { id: newId(), type: "cta", text: SLOT_CTA[ctx.slot], url: ctx.primary.url }
  );
  return out;
}

function blocksForBlurBestsellers(ctx: PresetCtx): BlockNode[] {
  const out: BlockNode[] = [];
  out.push(
    {
      id: newId(),
      type: "hero",
      image_url: ctx.primary.image_url,
      alt: ctx.primary.name,
    },
    { id: newId(), type: "hook", text: SLOT_HOOK[ctx.slot] },
    { id: newId(), type: "headline", text: SLOT_HEADLINE[ctx.slot], align: "center" },
    { id: newId(), type: "lead", text: SLOT_LEAD[ctx.slot], align: "center" },
    { id: newId(), type: "cta", text: SLOT_CTA[ctx.slot], url: ctx.primary.url },
    { id: newId(), type: "divider" }
  );
  if (ctx.related.length > 0) {
    out.push({
      id: newId(),
      type: "related-products",
      products: ctx.related.map((p) => ({
        name: p.name,
        price: p.price,
        old_price: p.old_price,
        image_url: p.image_url,
        url: p.url,
      })),
    });
  }
  return out;
}

const FAMILY_BUILDERS: Record<string, (ctx: PresetCtx) => BlockNode[]> = {
  classic: blocksForClassic,
  "single-detail": blocksForSingleDetail,
  "blur-bestsellers": blocksForBlurBestsellers,
  // Layouts the editor doesn't have a custom decomposition for yet fall back
  // to the classic skeleton — the user can rearrange from there.
  "editorial-overlay": blocksForClassic,
  "reviews-side-hero": blocksForClassic,
  "logo-asym-narrative": blocksForClassic,
  "overlay-dual-cta": blocksForClassic,
  "edition-narrative": blocksForSingleDetail,
  "numbered-grid": blocksForBlurBestsellers,
  "uniform-grid-3x3": blocksForBlurBestsellers,
  "slash-labels": blocksForSingleDetail,
};

function familyOf(layoutId: string): string {
  return layoutId.replace(/-(light|dark)$/, "");
}

export interface BuildPresetArgs {
  layoutId: string;
  slot: Slot;
  primary: ProductSnapshot;
  related: ProductSnapshot[];
  workspace_id: string;
  workspace_name?: string;
  coupon?: { code: string; discount_percent: number; expires_at: Date };
}

export function buildDraftFromLayout(args: BuildPresetArgs): Omit<Draft, "id" | "created_at" | "updated_at"> {
  const family = familyOf(args.layoutId);
  const isDark = args.layoutId.endsWith("-dark");
  const builder = FAMILY_BUILDERS[family] ?? blocksForClassic;
  const blocks = builder({
    slot: args.slot,
    primary: args.primary,
    related: args.related,
    mode: isDark ? "dark" : "light",
    coupon: args.coupon,
  });
  return {
    workspace_id: args.workspace_id,
    layout_id: args.layoutId,
    name: `${args.primary.name} · ${family}`,
    meta: {
      subject: subjectForSlot(args.slot, args.primary.name),
      preview: previewForSlot(args.slot, args.primary.name),
      mode: isDark ? "dark" : "light",
    },
    blocks,
  };
}

export interface SuggestionLikeCopy {
  subject: string;
  headline: string;
  lead: string;
  cta_text: string;
  cta_url: string;
}

/**
 * Build a Draft from a daily auto-suggestion. We seed using the same family
 * builders as the layout flow (classic by default), then walk the blocks and
 * patch the text fields with the suggestion's actual copy (subject, headline,
 * lead, cta) so the user lands in the editor with their real email rather
 * than the generic preset copy.
 */
export function buildDraftFromSuggestion(args: {
  workspace_id: string;
  layoutId?: string;
  slot: Slot;
  primary: ProductSnapshot;
  related: ProductSnapshot[];
  copy: SuggestionLikeCopy;
  coupon?: { code: string; discount_percent: number; expires_at: Date };
}): Omit<Draft, "id" | "created_at" | "updated_at"> {
  const seed = buildDraftFromLayout({
    layoutId: args.layoutId ?? "classic",
    slot: args.slot,
    primary: args.primary,
    related: args.related,
    workspace_id: args.workspace_id,
    coupon: args.coupon,
  });

  const patched: BlockNode[] = seed.blocks.map((b) => {
    if (b.type === "headline") return { ...b, text: args.copy.headline };
    if (b.type === "lead") return { ...b, text: args.copy.lead };
    if (b.type === "cta") return { ...b, text: args.copy.cta_text, url: args.copy.cta_url };
    return b;
  });

  return {
    ...seed,
    name: `${args.primary.name} · sugestão slot ${args.slot}`,
    meta: {
      ...seed.meta,
      subject: args.copy.subject,
      preview: args.copy.lead.slice(0, 90),
    },
    blocks: patched,
  };
}

function subjectForSlot(slot: Slot, productName: string): string {
  if (slot === 1) return `${productName}: a peça mais vestida da semana`;
  if (slot === 2) return `Estoque acabando: ${productName}`;
  return `${productName} acabou de chegar`;
}

function previewForSlot(slot: Slot, productName: string): string {
  if (slot === 1) return `Top 1 e dá pra ver por quê: ${productName}.`;
  if (slot === 2) return `Última chance. ${productName} com cupom dentro.`;
  return `Acabou de chegar: ${productName}.`;
}
