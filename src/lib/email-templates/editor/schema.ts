// src/lib/email-templates/editor/schema.ts
//
// Block schema for the drag-and-drop email editor. A draft is a list of
// `BlockNode`s rendered into email-safe HTML by render.ts, reusing the
// shared.ts primitives so output stays Gmail/Outlook-safe.
//
// All blocks share an `id` (used by dnd-kit) and a `type` discriminator. Each
// type carries its own props. The editor's inspector switches on `type` to
// surface the right form.

import type { ProductSnapshot } from "../types";

export type BlockId = string;

export type EmailMode = "light" | "dark";

export interface LogoConfig {
  /** Image URL (or empty string for no logo, or "default" for the Bulking logo) */
  image_url: string;
  /** Display width in px (clamped 60–300) */
  width: number;
  /** Alt text */
  alt: string;
}

export interface DraftMeta {
  /** Subject line (rendered in <title> + Gmail snippet) */
  subject: string;
  /** Hidden preview text */
  preview: string;
  /** Light or dark canvas wrapper */
  mode: EmailMode;
  /** Logo block at the top of the email. Optional — drop to hide entirely. */
  logo?: LogoConfig | null;
}

export const DEFAULT_LOGO: LogoConfig = {
  image_url: "https://cdn.vnda.com.br/bulking/2023/12/01/18_12_2_290_logobulkingsite.svg?v=1701465320",
  width: 148,
  alt: "BULKING",
};

// ---- Block types ----

export interface TextStyle {
  /** Font size in px (uncapped, but UI presets stay between 11–80) */
  font_size?: number;
  /** Capped at 600 per brand system — no 700/800 */
  font_weight?: 300 | 400 | 500 | 600;
  italic?: boolean;
  /** Hex color override (e.g. "#FFFFFF"). When unset, the helper picks a
   *  mode-aware default. */
  color?: string;
}

export interface HeroBlock {
  id: BlockId;
  type: "hero";
  image_url: string;
  alt: string;
  badge?: string;
}

export interface HeadlineBlock {
  id: BlockId;
  type: "headline";
  text: string;
  /** Optional WYSIWYG-produced HTML; takes precedence over `text` when set. */
  html?: string;
  align?: "left" | "center";
  style?: TextStyle;
}

export interface LeadBlock {
  id: BlockId;
  type: "lead";
  text: string;
  html?: string;
  align?: "left" | "center";
  style?: TextStyle;
}

export interface HookBlock {
  id: BlockId;
  type: "hook";
  text: string;
  html?: string;
  style?: TextStyle;
}

export interface CtaBlock {
  id: BlockId;
  type: "cta";
  text: string;
  url: string;
}

export interface ProductMetaBlock {
  id: BlockId;
  type: "product-meta";
  name: string;
  price: number;
  old_price?: number;
}

export interface RelatedProductsBlock {
  id: BlockId;
  type: "related-products";
  products: Array<{
    name: string;
    price: number;
    old_price?: number;
    image_url: string;
    url: string;
  }>;
}

export interface RatingBlock {
  id: BlockId;
  type: "rating";
  rating: number; // 0–5
  count?: number;
}

export interface DiscountBadgeBlock {
  id: BlockId;
  type: "discount-badge";
  discount_percent: number;
}

export interface CouponBlock {
  id: BlockId;
  type: "coupon";
  code: string;
  discount_percent: number;
  product_name: string;
}

export interface CountdownBlock {
  id: BlockId;
  type: "countdown";
  /** ISO timestamp when the timer hits zero */
  expires_at: string;
}

export interface SpacerBlock {
  id: BlockId;
  type: "spacer";
  height: number; // px
}

export interface DividerBlock {
  id: BlockId;
  type: "divider";
}

export interface RichTextBlock {
  id: BlockId;
  type: "rich-text";
  /** Plain text, used only when `html` is empty (legacy drafts). */
  text: string;
  /** Tiptap-produced HTML. Takes precedence when set. */
  html?: string;
  align?: "left" | "center";
  style?: TextStyle;
}

export interface ImageBlock {
  id: BlockId;
  type: "image";
  image_url: string;
  alt: string;
  href?: string;
}

export type BlockNode =
  | HeroBlock
  | HeadlineBlock
  | LeadBlock
  | HookBlock
  | CtaBlock
  | ProductMetaBlock
  | RelatedProductsBlock
  | RatingBlock
  | DiscountBadgeBlock
  | CouponBlock
  | CountdownBlock
  | SpacerBlock
  | DividerBlock
  | RichTextBlock
  | ImageBlock;

export type BlockType = BlockNode["type"];

export interface Draft {
  id: string;
  workspace_id: string;
  layout_id?: string;
  name: string;
  meta: DraftMeta;
  blocks: BlockNode[];
  created_at: string;
  updated_at: string;
}

// ---- Defaults for the palette ----

export function newId(): string {
  return `b_${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultBlock(type: BlockType, primary?: ProductSnapshot): BlockNode {
  const id = newId();
  switch (type) {
    case "hero":
      return {
        id,
        type,
        image_url: primary?.image_url ?? "",
        alt: primary?.name ?? "Produto em destaque",
        badge: "Top 1 da semana",
      };
    case "headline":
      return { id, type, text: "Top 1 e dá pra ver por quê.", align: "center" };
    case "lead":
      return {
        id,
        type,
        text: "Caimento pra quem treina, design feito pra durar.",
        align: "center",
      };
    case "hook":
      return { id, type, text: "O top 1 da semana" };
    case "cta":
      return { id, type, text: "Ver na loja", url: primary?.url ?? "https://www.bulking.com.br" };
    case "product-meta":
      return {
        id,
        type,
        name: primary?.name ?? "Produto",
        price: primary?.price ?? 0,
        old_price: primary?.old_price,
      };
    case "related-products":
      return { id, type, products: [] };
    case "rating":
      return { id, type, rating: 5 };
    case "discount-badge":
      return { id, type, discount_percent: 10 };
    case "coupon":
      return {
        id,
        type,
        code: "EMAIL-XXXXX",
        discount_percent: 10,
        product_name: primary?.name ?? "Produto",
      };
    case "countdown":
      return {
        id,
        type,
        expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      };
    case "spacer":
      return { id, type, height: 24 };
    case "divider":
      return { id, type };
    case "rich-text":
      return { id, type, text: "Escreva aqui...", align: "center" };
    case "image":
      return {
        id,
        type,
        image_url: primary?.image_url ?? "",
        alt: primary?.name ?? "",
      };
  }
}

export const PALETTE: Array<{
  type: BlockType;
  label: string;
  description: string;
  group: "header" | "content" | "commerce" | "structural";
}> = [
  { type: "hook", label: "Eyebrow", description: "Tagline acima do produto", group: "header" },
  { type: "hero", label: "Produto", description: "Foto principal do produto", group: "header" },
  { type: "headline", label: "Headline", description: "Título grande", group: "content" },
  { type: "lead", label: "Lead", description: "Parágrafo de apoio", group: "content" },
  { type: "rich-text", label: "Texto livre", description: "Parágrafo livre", group: "content" },
  { type: "image", label: "Imagem", description: "Imagem com link opcional", group: "content" },
  { type: "rating", label: "Estrelas", description: "Avaliação 0–5", group: "content" },
  { type: "cta", label: "Botão CTA", description: "Botão preto com link", group: "content" },
  { type: "product-meta", label: "Preço + nome", description: "Bloco de preço", group: "commerce" },
  {
    type: "related-products",
    label: "Grade de produtos",
    description: "3 produtos relacionados",
    group: "commerce",
  },
  {
    type: "discount-badge",
    label: "Selo de desconto",
    description: "Badge com % off",
    group: "commerce",
  },
  { type: "coupon", label: "Cupom", description: "Código + desconto", group: "commerce" },
  { type: "countdown", label: "Countdown", description: "Timer animado", group: "commerce" },
  { type: "spacer", label: "Espaço", description: "Espaço vertical", group: "structural" },
  { type: "divider", label: "Divisor", description: "Linha horizontal", group: "structural" },
];
