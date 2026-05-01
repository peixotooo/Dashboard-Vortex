// src/lib/email-templates/layouts/types.ts
import type { TemplateRenderContext, Slot } from "../types";

export type LayoutId =
  | "classic"
  | "editorial-overlay-light"
  | "numbered-grid-light"
  | "slash-labels-dark"
  | "single-detail-dark";

export interface LayoutDef {
  id: LayoutId;
  pattern_name: string;
  reference_image: string;
  mode: "light" | "dark";
  slots: Slot[]; // which suggestion slots this layout supports
  product_count: number; // expected related_products count
  render: (ctx: TemplateRenderContext) => string;
}
