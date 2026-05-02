// src/lib/email-templates/tree/presets.ts
//
// Tree presets per layout family. Each preset returns the SectionNode list
// that the editor will load when the user clicks "Usar template" on a
// matching layout. The tree primitives (Section/Row/Column) let us actually
// preserve multi-column structures — reviews-side-hero stays 2-column, the
// 3x3 grid stays a 3x3 grid — instead of collapsing everything to a single
// vertical column like the previous block model.

import type { Slot, ProductSnapshot } from "../types";
import type { SectionNode, ColumnNode, LeafNode, RowNode, TreeDraft, Mode } from "./schema";
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

interface BuildCtx {
  slot: Slot;
  primary: ProductSnapshot;
  related: ProductSnapshot[];
  mode: Mode;
  coupon?: { code: string; discount_percent: number; expires_at: Date };
}

function logoSection(): SectionNode {
  return {
    id: newId(),
    type: "section",
    padding: "32px 24px 24px",
    children: [
      {
        id: newId(),
        type: "logo",
        image_url:
          "https://cdn.vnda.com.br/bulking/2023/12/01/18_12_2_290_logobulkingsite.svg?v=1701465320",
        width: 148,
        alt: "BULKING",
      },
    ],
  };
}

function footerSection(mode: Mode): SectionNode {
  return {
    id: newId(),
    type: "section",
    padding: "48px 32px 40px",
    align: "center",
    children: [
      { id: newId(), type: "divider" },
      {
        id: newId(),
        type: "text",
        text: "Respect the Hustle.",
        align: "center",
        style: { size: 12, weight: 500, color: mode === "dark" ? "#FFFFFF" : "#000000", uppercase: true, letterSpacing: 0.32 },
      },
      {
        id: newId(),
        type: "text",
        text: "Bulking · bulking.com.br",
        align: "center",
        style: { size: 12, weight: 400, color: mode === "dark" ? "#A8A8A8" : "#6E6E6E" },
      },
    ],
  };
}

// ---------- Family builders ----------

function buildClassic(ctx: BuildCtx): SectionNode[] {
  const sections: SectionNode[] = [logoSection()];

  if (ctx.coupon) {
    sections.push({
      id: newId(),
      type: "section",
      padding: "0",
      children: [
        { id: newId(), type: "countdown", expires_at: ctx.coupon.expires_at.toISOString() },
      ],
    });
  }

  sections.push({
    id: newId(),
    type: "section",
    padding: "32px 32px 16px",
    align: "center",
    children: [
      { id: newId(), type: "eyebrow", text: SLOT_HOOK[ctx.slot], align: "center" },
    ],
  });

  if (ctx.coupon) {
    sections.push({
      id: newId(),
      type: "section",
      padding: "0 32px 16px",
      children: [
        { id: newId(), type: "discount-badge", discount_percent: ctx.coupon.discount_percent },
      ],
    });
  }

  sections.push({
    id: newId(),
    type: "section",
    padding: "0",
    children: [
      {
        id: newId(),
        type: "image",
        src: ctx.primary.image_url,
        alt: ctx.primary.name,
        ratio: "3:4",
      },
    ],
  });

  sections.push({
    id: newId(),
    type: "section",
    padding: "32px 40px 24px",
    align: "center",
    children: [
      { id: newId(), type: "heading", text: SLOT_HEADLINE[ctx.slot], align: "center" },
      { id: newId(), type: "rating", rating: 5 },
      { id: newId(), type: "text", text: SLOT_LEAD[ctx.slot], align: "center" },
    ],
  });

  if (ctx.coupon) {
    sections.push({
      id: newId(),
      type: "section",
      padding: "0 32px 24px",
      children: [
        {
          id: newId(),
          type: "coupon",
          code: ctx.coupon.code,
          discount_percent: ctx.coupon.discount_percent,
          product_name: ctx.primary.name,
        },
      ],
    });
  }

  sections.push({
    id: newId(),
    type: "section",
    padding: "0 40px 40px",
    align: "center",
    children: [
      {
        id: newId(),
        type: "product-meta",
        name: ctx.primary.name,
        price: ctx.primary.price,
        old_price: ctx.primary.old_price,
      },
      {
        id: newId(),
        type: "button",
        text: SLOT_CTA[ctx.slot],
        href: ctx.primary.url || "https://www.bulking.com.br",
        variant: "primary",
      },
    ],
  });

  if (ctx.related.length > 0) {
    sections.push(buildRelatedSection(ctx.related.slice(0, 3), 3));
  }

  sections.push(footerSection(ctx.mode));
  return sections;
}

function buildReviewsSideHero(ctx: BuildCtx): SectionNode[] {
  // 2-column: reviews on left, hero on right.
  const reviewsCol: ColumnNode = {
    id: newId(),
    type: "column",
    width_pct: 45,
    v_align: "middle",
    padding: "0 16px",
    children: [
      { id: newId(), type: "eyebrow", text: "Avaliações reais", align: "left" },
      { id: newId(), type: "rating", rating: 5, count: 248 },
      {
        id: newId(),
        type: "text",
        text: "“Caimento absurdo. Não tira mais.”",
        align: "left",
        style: { size: 18, weight: 500 },
      },
      {
        id: newId(),
        type: "text",
        text: "— cliente Bulking",
        align: "left",
        style: { size: 12, weight: 400, color: "#6E6E6E" },
      },
    ],
  };
  const heroCol: ColumnNode = {
    id: newId(),
    type: "column",
    width_pct: 55,
    v_align: "top",
    padding: "0",
    children: [
      {
        id: newId(),
        type: "image",
        src: ctx.primary.image_url,
        alt: ctx.primary.name,
        ratio: "3:4",
      },
    ],
  };

  const sections: SectionNode[] = [
    logoSection(),
    {
      id: newId(),
      type: "section",
      padding: "24px 24px",
      children: [{ id: newId(), type: "row", columns: [reviewsCol, heroCol] }],
    },
    {
      id: newId(),
      type: "section",
      padding: "16px 40px 32px",
      align: "center",
      children: [
        { id: newId(), type: "heading", text: SLOT_HEADLINE[ctx.slot], align: "center" },
        { id: newId(), type: "text", text: SLOT_LEAD[ctx.slot], align: "center" },
        {
          id: newId(),
          type: "product-meta",
          name: ctx.primary.name,
          price: ctx.primary.price,
          old_price: ctx.primary.old_price,
        },
        { id: newId(), type: "button", text: SLOT_CTA[ctx.slot], href: ctx.primary.url, variant: "primary" },
      ],
    },
    footerSection(ctx.mode),
  ];
  return sections;
}

function buildUniformGrid3x3(ctx: BuildCtx): SectionNode[] {
  const products = [ctx.primary, ...ctx.related].slice(0, 9);
  return [
    logoSection(),
    {
      id: newId(),
      type: "section",
      padding: "32px 32px 16px",
      align: "center",
      children: [
        { id: newId(), type: "eyebrow", text: SLOT_HOOK[ctx.slot], align: "center" },
        { id: newId(), type: "heading", text: "THE INITIAL COLLECTION.", align: "center" },
        { id: newId(), type: "text", text: SLOT_LEAD[ctx.slot], align: "center" },
      ],
    },
    {
      id: newId(),
      type: "section",
      padding: "16px 24px 32px",
      children: [
        { id: newId(), type: "product-grid", columns: 3, products: products },
      ],
    },
    {
      id: newId(),
      type: "section",
      padding: "0 40px 40px",
      align: "center",
      children: [
        { id: newId(), type: "button", text: SLOT_CTA[ctx.slot], href: ctx.primary.url, variant: "primary" },
      ],
    },
    footerSection(ctx.mode),
  ];
}

function buildEditorialOverlay(ctx: BuildCtx): SectionNode[] {
  // Big split-word typography around the hero. Three sections stacked.
  return [
    logoSection(),
    {
      id: newId(),
      type: "section",
      padding: "48px 32px 8px",
      align: "center",
      children: [
        {
          id: newId(),
          type: "heading",
          text: "ÚLTIMA",
          align: "center",
          style: { size: 72, weight: 600, letterSpacing: -0.02 },
        },
      ],
    },
    {
      id: newId(),
      type: "section",
      padding: "0",
      children: [
        {
          id: newId(),
          type: "image",
          src: ctx.primary.image_url,
          alt: ctx.primary.name,
          ratio: "3:4",
        },
      ],
    },
    {
      id: newId(),
      type: "section",
      padding: "8px 32px 24px",
      align: "center",
      children: [
        {
          id: newId(),
          type: "heading",
          text: "CHANCE.",
          align: "center",
          style: { size: 72, weight: 600, letterSpacing: -0.02 },
        },
        { id: newId(), type: "text", text: SLOT_LEAD[ctx.slot], align: "center" },
        {
          id: newId(),
          type: "product-meta",
          name: ctx.primary.name,
          price: ctx.primary.price,
          old_price: ctx.primary.old_price,
        },
        { id: newId(), type: "button", text: SLOT_CTA[ctx.slot], href: ctx.primary.url, variant: "primary" },
      ],
    },
    footerSection(ctx.mode),
  ];
}

function buildLogoAsymNarrative(ctx: BuildCtx): SectionNode[] {
  // Asymmetric: hook + headline left-aligned, hero on the right takes most of the row.
  const leftCol: ColumnNode = {
    id: newId(),
    type: "column",
    width_pct: 40,
    v_align: "middle",
    padding: "0 16px",
    children: [
      { id: newId(), type: "eyebrow", text: SLOT_HOOK[ctx.slot], align: "left" },
      { id: newId(), type: "heading", text: SLOT_HEADLINE[ctx.slot], align: "left", style: { size: 32, weight: 500 } },
      { id: newId(), type: "text", text: SLOT_LEAD[ctx.slot], align: "left" },
      { id: newId(), type: "button", text: SLOT_CTA[ctx.slot], href: ctx.primary.url, variant: "primary" },
    ],
  };
  const rightCol: ColumnNode = {
    id: newId(),
    type: "column",
    width_pct: 60,
    v_align: "top",
    padding: "0",
    children: [
      {
        id: newId(),
        type: "image",
        src: ctx.primary.image_url,
        alt: ctx.primary.name,
        ratio: "3:4",
      },
    ],
  };
  return [
    logoSection(),
    {
      id: newId(),
      type: "section",
      padding: "24px 16px",
      children: [{ id: newId(), type: "row", columns: [leftCol, rightCol] }],
    },
    footerSection(ctx.mode),
  ];
}

function buildOverlayDualCta(ctx: BuildCtx): SectionNode[] {
  return [
    logoSection(),
    {
      id: newId(),
      type: "section",
      padding: "0",
      children: [
        {
          id: newId(),
          type: "image",
          src: ctx.primary.image_url,
          alt: ctx.primary.name,
          ratio: "3:4",
        },
      ],
    },
    {
      id: newId(),
      type: "section",
      padding: "32px 40px 24px",
      align: "center",
      children: [
        { id: newId(), type: "heading", text: SLOT_HEADLINE[ctx.slot], align: "center" },
        { id: newId(), type: "text", text: SLOT_LEAD[ctx.slot], align: "center" },
        { id: newId(), type: "button", text: SLOT_CTA[ctx.slot], href: ctx.primary.url, variant: "primary" },
        { id: newId(), type: "button", text: "Ver coleção", href: "https://www.bulking.com.br", variant: "secondary" },
      ],
    },
    ctx.related.length > 0 ? buildRelatedSection(ctx.related.slice(0, 3), 3) : null,
    footerSection(ctx.mode),
  ].filter(Boolean) as SectionNode[];
}

function buildEditionNarrative(ctx: BuildCtx): SectionNode[] {
  return [
    logoSection(),
    {
      id: newId(),
      type: "section",
      padding: "32px 32px 16px",
      align: "center",
      children: [
        { id: newId(), type: "eyebrow", text: "EDIÇÃO 003 · " + SLOT_HOOK[ctx.slot], align: "center" },
        { id: newId(), type: "heading", text: SLOT_HEADLINE[ctx.slot], align: "center" },
        {
          id: newId(),
          type: "text",
          text: "Cada peça da coleção foi pensada pra durar mais que a próxima onda. Caimento, gramatura, costuras: tudo testado em treino, não em studio.",
          align: "center",
          style: { italic: true },
        },
      ],
    },
    {
      id: newId(),
      type: "section",
      padding: "0",
      children: [
        {
          id: newId(),
          type: "image",
          src: ctx.primary.image_url,
          alt: ctx.primary.name,
          ratio: "3:4",
        },
      ],
    },
    {
      id: newId(),
      type: "section",
      padding: "24px 40px 24px",
      align: "center",
      children: [
        { id: newId(), type: "divider" },
        {
          id: newId(),
          type: "product-meta",
          name: ctx.primary.name,
          price: ctx.primary.price,
          old_price: ctx.primary.old_price,
        },
        { id: newId(), type: "button", text: SLOT_CTA[ctx.slot], href: ctx.primary.url, variant: "primary" },
      ],
    },
    footerSection(ctx.mode),
  ];
}

function buildNumberedGrid(ctx: BuildCtx): SectionNode[] {
  const products = [ctx.primary, ...ctx.related].slice(0, 4);
  return [
    logoSection(),
    {
      id: newId(),
      type: "section",
      padding: "32px 32px 16px",
      align: "center",
      children: [
        { id: newId(), type: "eyebrow", text: SLOT_HOOK[ctx.slot], align: "center" },
        { id: newId(), type: "heading", text: SLOT_HEADLINE[ctx.slot], align: "center" },
      ],
    },
    {
      id: newId(),
      type: "section",
      padding: "0 24px 32px",
      children: [
        { id: newId(), type: "product-grid", columns: 2, products, numbered: true },
      ],
    },
    {
      id: newId(),
      type: "section",
      padding: "0 40px 40px",
      align: "center",
      children: [
        { id: newId(), type: "button", text: SLOT_CTA[ctx.slot], href: ctx.primary.url, variant: "primary" },
      ],
    },
    footerSection(ctx.mode),
  ];
}

function buildSlashLabels(ctx: BuildCtx): SectionNode[] {
  return [
    logoSection(),
    {
      id: newId(),
      type: "section",
      padding: "24px 24px 8px",
      children: [
        {
          id: newId(),
          type: "slash-labels",
          labels: ["BULKING", "2026", "DROP 03"],
          align: "left",
        },
      ],
    },
    {
      id: newId(),
      type: "section",
      padding: "0",
      children: [
        {
          id: newId(),
          type: "image",
          src: ctx.primary.image_url,
          alt: ctx.primary.name,
          ratio: "3:4",
        },
      ],
    },
    {
      id: newId(),
      type: "section",
      padding: "16px 24px 8px",
      children: [
        {
          id: newId(),
          type: "slash-labels",
          labels: ["AUTHENTIC", "WORN", "TESTED"],
          align: "right",
        },
      ],
    },
    {
      id: newId(),
      type: "section",
      padding: "16px 40px 32px",
      align: "center",
      children: [
        { id: newId(), type: "heading", text: SLOT_HEADLINE[ctx.slot], align: "center" },
        { id: newId(), type: "text", text: SLOT_LEAD[ctx.slot], align: "center" },
        {
          id: newId(),
          type: "product-meta",
          name: ctx.primary.name,
          price: ctx.primary.price,
          old_price: ctx.primary.old_price,
        },
        { id: newId(), type: "button", text: SLOT_CTA[ctx.slot], href: ctx.primary.url, variant: "primary" },
      ],
    },
    footerSection(ctx.mode),
  ];
}

function buildSingleDetail(ctx: BuildCtx): SectionNode[] {
  return [
    logoSection(),
    {
      id: newId(),
      type: "section",
      padding: "32px 32px 8px",
      align: "center",
      children: [
        { id: newId(), type: "eyebrow", text: SLOT_HOOK[ctx.slot], align: "center" },
        { id: newId(), type: "heading", text: SLOT_HEADLINE[ctx.slot], align: "center" },
      ],
    },
    {
      id: newId(),
      type: "section",
      padding: "0",
      children: [
        {
          id: newId(),
          type: "image",
          src: ctx.primary.image_url,
          alt: ctx.primary.name,
          ratio: "3:4",
        },
      ],
    },
    {
      id: newId(),
      type: "section",
      padding: "32px 40px 32px",
      align: "center",
      children: [
        { id: newId(), type: "text", text: SLOT_LEAD[ctx.slot], align: "center" },
        {
          id: newId(),
          type: "product-meta",
          name: ctx.primary.name,
          price: ctx.primary.price,
          old_price: ctx.primary.old_price,
        },
        { id: newId(), type: "button", text: SLOT_CTA[ctx.slot], href: ctx.primary.url, variant: "primary" },
      ],
    },
    footerSection(ctx.mode),
  ];
}

function buildBlurBestsellers(ctx: BuildCtx): SectionNode[] {
  return [
    logoSection(),
    {
      id: newId(),
      type: "section",
      padding: "0",
      children: [
        {
          id: newId(),
          type: "image",
          src: ctx.primary.image_url,
          alt: ctx.primary.name,
          ratio: "3:4",
        },
      ],
    },
    {
      id: newId(),
      type: "section",
      padding: "24px 40px 24px",
      align: "center",
      children: [
        { id: newId(), type: "eyebrow", text: SLOT_HOOK[ctx.slot], align: "center" },
        { id: newId(), type: "heading", text: SLOT_HEADLINE[ctx.slot], align: "center" },
        { id: newId(), type: "text", text: SLOT_LEAD[ctx.slot], align: "center" },
        { id: newId(), type: "button", text: SLOT_CTA[ctx.slot], href: ctx.primary.url, variant: "primary" },
      ],
    },
    ctx.related.length > 0 ? buildRelatedSection(ctx.related.slice(0, 3), 3) : null,
    footerSection(ctx.mode),
  ].filter(Boolean) as SectionNode[];
}

function buildRelatedSection(products: ProductSnapshot[], cols: 2 | 3 | 4): SectionNode {
  return {
    id: newId(),
    type: "section",
    padding: "16px 24px 40px",
    children: [
      {
        id: newId(),
        type: "text",
        text: "Selecionados pra você",
        align: "center",
        style: { size: 13, weight: 500, uppercase: true, letterSpacing: 0.32 },
      },
      { id: newId(), type: "spacer", height: 16 },
      { id: newId(), type: "product-grid", columns: cols, products },
    ],
  };
}

// ---------- Family map ----------

const FAMILY_BUILDERS: Record<string, (ctx: BuildCtx) => SectionNode[]> = {
  classic: buildClassic,
  "single-detail": buildSingleDetail,
  "blur-bestsellers": buildBlurBestsellers,
  "editorial-overlay": buildEditorialOverlay,
  "reviews-side-hero": buildReviewsSideHero,
  "logo-asym-narrative": buildLogoAsymNarrative,
  "overlay-dual-cta": buildOverlayDualCta,
  "edition-narrative": buildEditionNarrative,
  "numbered-grid": buildNumberedGrid,
  "uniform-grid-3x3": buildUniformGrid3x3,
  "slash-labels": buildSlashLabels,
};

function familyOf(layoutId: string): string {
  return layoutId.replace(/-(light|dark)$/, "");
}

export interface BuildArgs {
  layoutId: string;
  slot: Slot;
  primary: ProductSnapshot;
  related: ProductSnapshot[];
  workspace_id: string;
  coupon?: { code: string; discount_percent: number; expires_at: Date };
}

export function buildTreeDraftFromLayout(
  args: BuildArgs
): Omit<TreeDraft, "id" | "created_at" | "updated_at"> {
  const family = familyOf(args.layoutId);
  const isDark = args.layoutId.endsWith("-dark");
  const builder = FAMILY_BUILDERS[family] ?? buildClassic;
  const sections = builder({
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
    sections,
  };
}

export function buildTreeDraftFromSuggestion(args: {
  workspace_id: string;
  layoutId?: string;
  slot: Slot;
  primary: ProductSnapshot;
  related: ProductSnapshot[];
  copy: { subject: string; headline: string; lead: string; cta_text: string; cta_url: string };
  coupon?: { code: string; discount_percent: number; expires_at: Date };
}): Omit<TreeDraft, "id" | "created_at" | "updated_at"> {
  const seed = buildTreeDraftFromLayout({
    layoutId: args.layoutId ?? "classic",
    slot: args.slot,
    primary: args.primary,
    related: args.related,
    workspace_id: args.workspace_id,
    coupon: args.coupon,
  });
  // Patch the copy in headings/text/buttons.
  const patched = seed.sections.map((s) => patchCopyInSection(s, args.copy));
  return {
    ...seed,
    name: `${args.primary.name} · sugestão slot ${args.slot}`,
    meta: {
      ...seed.meta,
      subject: args.copy.subject,
      preview: args.copy.lead.slice(0, 90),
    },
    sections: patched,
  };
}

function patchCopyInSection(
  s: SectionNode,
  copy: { headline: string; lead: string; cta_text: string; cta_url: string }
): SectionNode {
  return {
    ...s,
    children: s.children.map((child) => {
      if (child.type === "row") {
        return {
          ...child,
          columns: child.columns.map((col) => ({
            ...col,
            children: col.children.map((leaf) => patchLeaf(leaf, copy)) as LeafNode[],
          })),
        } as RowNode;
      }
      return patchLeaf(child as LeafNode, copy);
    }),
  };
}

function patchLeaf(
  leaf: LeafNode,
  copy: { headline: string; lead: string; cta_text: string; cta_url: string }
): LeafNode {
  if (leaf.type === "heading") return { ...leaf, text: copy.headline };
  if (leaf.type === "text") return { ...leaf, text: copy.lead };
  if (leaf.type === "button")
    return { ...leaf, text: copy.cta_text, href: copy.cta_url };
  return leaf;
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
