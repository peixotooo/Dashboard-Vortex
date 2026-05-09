export type Slot = 1 | 2 | 3;

export type CopyProvider = "template" | "llm";

export type SuggestionStatus = "pending" | "selected" | "sent";

export type SegmentType = "rfm" | "attribute";

export interface ResolvedSegment {
  type: SegmentType;
  payload: { rfm_classes?: string[]; [k: string]: unknown };
  estimated_size: number;
  display_label: string;
}

export interface ProductSnapshot {
  vnda_id: string;
  name: string;
  price: number;
  old_price?: number;
  image_url: string;
  url: string;
  description?: string;
  tags?: string[];
  /** Product category (e.g. "calça", "camiseta") — populated from
   *  shelf_products.category. Used by the picker's category-penalty to
   *  prevent slot saturation by the same category over consecutive
   *  days. Optional because older snapshots predate this field. */
  category?: string;
  /** Primary SKU. Lets the RFM aggregator cross-reference customer
   *  purchase items.sku with the product catalog and populate
   *  preferredColors / preferredCategories per customer. */
  sku?: string;
}

export interface CopyOutput {
  subject: string;
  headline: string;
  lead: string;
  cta_text: string;
  cta_url: string;
}

export interface CopyInput {
  slot: Slot;
  product: ProductSnapshot;
  segment: ResolvedSegment;
  coupon?: { code: string; discount_percent: number; expires_at: Date };
  workspace_id: string;
}

export interface CopyProviderImpl {
  generate(input: CopyInput): Promise<CopyOutput>;
}

export interface HoursPick {
  recommended_hours: number[]; // length 3, values 0..23
  hours_score: Record<string, number>;
}

export interface EmailTemplateSettings {
  workspace_id: string;
  enabled: boolean;
  bestseller_lookback_days: number;
  slowmoving_lookback_days: number;
  newarrival_lookback_days: number;
  min_stock_bestseller: number;
  slowmoving_max_sales: number;
  slowmoving_discount_percent: number;
  slowmoving_coupon_validity_hours: number;
  copy_provider: CopyProvider;
  llm_agent_slug: string | null;
  /** Maps the VNDA item attribute1 column to a human label per workspace.
   *  Default "cor" — matches Bulking and most BR fashion catalogs.
   *  Used by the RFM aggregator to bucket purchases into preferredColors. */
  attribute1_label: string | null;
  /** Same idea for attribute2. Default "tamanho". */
  attribute2_label: string | null;
  /** Anti-repetition tunables (Frente C). */
  category_penalty_weight: number;
  exploration_rate: number;
  auto_relax_threshold: number;
  /** Bestseller scoring tunables (Frente B). */
  momentum_window_hours: number;
  bestseller_revenue_weight: number;
  /** When true, cross-validates GA4 top sellers against crm_vendas.items
   *  before promoting them — kills products with strong GA4 ghost
   *  signal but no real receipts. */
  crm_validation_enabled: boolean;
  /** Margin (0..1) used to estimate cost when a SKU has no entry in
   *  product_costs. Default 0.5 = "50% gross margin assumed" — typical
   *  baseline for fashion. The ABC compute (lib/crm-abc.ts) uses this
   *  as the fallback when a SKU isn't in the costs table; product_costs
   *  always wins when available. */
  default_margin_pct: number;
}

export interface EmailSuggestion {
  id: string;
  workspace_id: string;
  generated_for_date: string;
  slot: Slot;
  vnda_product_id: string;
  product_snapshot: ProductSnapshot;
  target_segment_type: SegmentType;
  target_segment_payload: Record<string, unknown>;
  copy: CopyOutput;
  copy_provider: CopyProvider;
  rendered_html: string;
  recommended_hours: number[];
  hours_score: Record<string, number> | null;
  coupon_code: string | null;
  coupon_vnda_promotion_id: number | null;
  coupon_vnda_coupon_id: number | null;
  coupon_expires_at: string | null;
  coupon_discount_percent: number | null;
  status: SuggestionStatus;
  selected_at: string | null;
  selected_count: number;
  sent_at: string | null;
  sent_hour_chosen: number | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateRenderContext {
  slot: Slot; // 1 = bestseller, 2 = slowmoving, 3 = newarrival
  product: ProductSnapshot;
  related_products: ProductSnapshot[];
  copy: CopyOutput;
  coupon?: { code: string; discount_percent: number; expires_at: Date; countdown_url: string };
  workspace: { name: string; logo_url?: string };
  hook?: string;
  /**
   * Optional generated hero image (from kie.ai GPT Image 2 pipeline). When
   * present, layouts use this URL for the hero block instead of product.image_url.
   */
  hero_url?: string;
}
