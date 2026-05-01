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
}
