// src/lib/email-templates/tree/schema.ts
//
// Tree-based draft schema, replacement for the flat block-list model. The
// new model maps to react-email's component tree: a draft is a sequence of
// Section nodes, each Section can contain Rows (horizontal layout) which in
// turn carry Columns. This is what unlocks the layout structures the flat
// model couldn't express — 2-column reviews+hero, 3x3 product grids,
// asymmetric narrative layouts, etc.

import type { ProductSnapshot } from "../types";

export type NodeId = string;
export type Align = "left" | "center" | "right";
export type Mode = "light" | "dark";

// ---------- Style primitives ----------

export interface TextStyle {
  size?: number; // px
  weight?: 300 | 400 | 500 | 600;
  italic?: boolean;
  color?: string;
  letterSpacing?: number; // em fraction (e.g. 0.32)
  lineHeight?: number;
  uppercase?: boolean;
}

// ---------- Leaf nodes ----------

export interface HeadingNode {
  id: NodeId;
  type: "heading";
  text: string;
  /** Optional Tiptap-produced rich HTML (overrides plain text) */
  html?: string;
  align?: Align;
  level?: 1 | 2 | 3;
  style?: TextStyle;
}

export interface TextNode {
  id: NodeId;
  type: "text";
  text: string;
  html?: string;
  align?: Align;
  style?: TextStyle;
}

export interface EyebrowNode {
  id: NodeId;
  type: "eyebrow";
  text: string;
  html?: string;
  align?: Align;
  style?: TextStyle;
}

export interface ButtonNode {
  id: NodeId;
  type: "button";
  text: string;
  href: string;
  variant?: "primary" | "secondary";
}

export interface ImageNode {
  id: NodeId;
  type: "image";
  src: string;
  alt: string;
  /** Force 3:4 / 4:5 / 1:1 / "free". Default 3:4 to keep heights consistent. */
  ratio?: "3:4" | "4:5" | "1:1" | "16:9" | "free";
  href?: string;
}

export interface SpacerNode {
  id: NodeId;
  type: "spacer";
  height: number;
}

export interface DividerNode {
  id: NodeId;
  type: "divider";
}

export interface RatingNode {
  id: NodeId;
  type: "rating";
  rating: number;
  count?: number;
}

export interface DiscountBadgeNode {
  id: NodeId;
  type: "discount-badge";
  discount_percent: number;
}

export interface CouponNode {
  id: NodeId;
  type: "coupon";
  code: string;
  discount_percent: number;
  product_name: string;
}

export interface CountdownNode {
  id: NodeId;
  type: "countdown";
  expires_at: string; // ISO
}

export interface ProductMetaNode {
  id: NodeId;
  type: "product-meta";
  name: string;
  price: number;
  old_price?: number;
}

export interface ProductCardNode {
  id: NodeId;
  type: "product-card";
  product: ProductSnapshot;
  align?: Align;
  show_price?: boolean;
  show_button?: boolean;
  button_text?: string;
}

export interface ProductGridNode {
  id: NodeId;
  type: "product-grid";
  products: ProductSnapshot[];
  /** Cells per row. 2, 3, or 4. */
  columns: 2 | 3 | 4;
  show_button?: boolean;
  button_text?: string;
  numbered?: boolean;
}

export interface SlashLabelsNode {
  id: NodeId;
  type: "slash-labels";
  labels: string[];
  align?: Align;
}

export interface LogoNode {
  id: NodeId;
  type: "logo";
  image_url: string;
  /** Width in px (clamped 60-300). */
  width?: number;
  alt?: string;
}

// ---------- Container nodes ----------

export interface ColumnNode {
  id: NodeId;
  type: "column";
  /** Width as % of parent row. Sum of columns in a row should be ≤ 100. */
  width_pct?: number;
  /** Optional vertical alignment within the row. */
  v_align?: "top" | "middle" | "bottom";
  padding?: string; // e.g. "16px 24px"
  children: LeafNode[];
}

export interface RowNode {
  id: NodeId;
  type: "row";
  columns: ColumnNode[];
}

export interface SectionNode {
  id: NodeId;
  type: "section";
  /** Background color. Defaults to canvas mode. */
  bg?: string;
  /** Padding inside the section. */
  padding?: string;
  /** Alignment of the inner stack. */
  align?: Align;
  /** Section can hold leaf nodes or rows (which split into columns). */
  children: Array<LeafNode | RowNode>;
}

// ---------- Unions ----------

export type LeafNode =
  | HeadingNode
  | TextNode
  | EyebrowNode
  | ButtonNode
  | ImageNode
  | SpacerNode
  | DividerNode
  | RatingNode
  | DiscountBadgeNode
  | CouponNode
  | CountdownNode
  | ProductMetaNode
  | ProductCardNode
  | ProductGridNode
  | SlashLabelsNode
  | LogoNode;

export type AnyNode = LeafNode | RowNode | ColumnNode | SectionNode;

// ---------- Draft ----------

export interface TreeDraftMeta {
  subject: string;
  preview: string;
  mode: Mode;
}

export interface TreeDraft {
  id: string;
  workspace_id: string;
  layout_id?: string;
  name: string;
  meta: TreeDraftMeta;
  /** Top-level: sequence of Sections. The renderer wraps these in
   *  the email Body + Container. */
  sections: SectionNode[];
  created_at: string;
  updated_at: string;
}

// ---------- Helpers ----------

export function newId(): string {
  return `n_${Math.random().toString(36).slice(2, 10)}`;
}
