// src/lib/email-templates/layouts/types.ts
import type { TemplateRenderContext, Slot } from "../types";

export type LayoutId =
  | "classic"
  | "editorial-overlay-light"
  | "editorial-overlay-dark"
  | "reviews-side-hero-light"
  | "reviews-side-hero-dark"
  | "logo-asym-narrative-light"
  | "logo-asym-narrative-dark"
  | "overlay-dual-cta-light"
  | "overlay-dual-cta-dark"
  | "edition-narrative-light"
  | "edition-narrative-dark"
  | "numbered-grid-light"
  | "numbered-grid-dark"
  | "uniform-grid-3x3-light"
  | "uniform-grid-3x3-dark"
  | "single-detail-light"
  | "single-detail-dark"
  | "slash-labels-light"
  | "slash-labels-dark"
  | "blur-bestsellers-light"
  | "blur-bestsellers-dark";

export interface LayoutDef {
  id: LayoutId;
  pattern_name: string;
  reference_image: string;
  mode: "light" | "dark";
  slots: Slot[];
  product_count: number;
  uses_hero?: boolean;
  render: (ctx: TemplateRenderContext) => string;
}
