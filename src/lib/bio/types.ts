import type { ShelfProduct } from "@/lib/shelves/algorithms";

export type BioBlockType =
  | "hero"
  | "products"
  | "categories"
  | "group"
  | "club"
  | "shipping"
  | "reviews";

export type BioProductAlgorithm =
  | "bestsellers"
  | "bestseller_camisetas"
  | "offers"
  | "news"
  | "most_popular"
  | "custom_tags"
  | "price_range";

export interface BioCategoryItem {
  id: string;
  label: string;
  url: string;
  description?: string;
  metric?: string;
  cover_image_url?: string | null;
}

export interface BioBlockConfig {
  id: string;
  type: BioBlockType;
  enabled: boolean;
  title: string;
  subtitle?: string;
  cta_label?: string;
  url?: string;
  algorithm?: BioProductAlgorithm;
  limit?: number;
  tags?: string[];
  price_min?: number | null;
  price_max?: number | null;
  items?: BioCategoryItem[];
  source?: "active_topbar" | "manual" | "automatic";
  pool_slug?: string;
}

export interface BioThemeConfig {
  background: string;
  foreground: string;
  muted: string;
  card: string;
  border: string;
  accent: string;
  accentForeground: string;
}

export interface BioPageConfig {
  workspace_id: string;
  enabled: boolean;
  slug: string;
  public_domain: string;
  store_base_url: string;
  brand_name: string;
  headline: string;
  subtitle: string;
  avatar_url: string | null;
  default_utm_campaign: string;
  blocks: BioBlockConfig[];
  theme: BioThemeConfig;
  updated_at?: string | null;
}

export interface BioReview {
  id: string;
  rating: number;
  body: string;
  author: string;
  date: string | null;
}

export interface BioResolvedBlockBase {
  id: string;
  type: BioBlockType;
  title: string;
  subtitle?: string;
  cta_label?: string;
  url?: string;
}

export interface BioHeroBenefit {
  title: string;
  message?: string;
}

export interface BioCountdownStyle {
  bg?: string | null;
  text?: string | null;
  fontWeight?: string | null;
  padding?: string | null;
  borderRadius?: string | null;
}

export interface BioResolvedHeroBlock extends BioResolvedBlockBase {
  type: "hero";
  badge?: string;
  countdown_target?: string | null;
  countdown_label?: string | null;
  countdown_style?: BioCountdownStyle | null;
  accent_color?: string | null;
  benefits?: BioHeroBenefit[];
  campaign_id?: string | null;
}

export interface BioResolvedProductsBlock extends BioResolvedBlockBase {
  type: "products";
  algorithm: BioProductAlgorithm;
  products: ShelfProduct[];
}

export interface BioResolvedCategoriesBlock extends BioResolvedBlockBase {
  type: "categories";
  items: BioCategoryItem[];
}

export interface BioResolvedLinkBlock extends BioResolvedBlockBase {
  type: "group" | "club" | "shipping";
}

export interface BioResolvedReviewsBlock extends BioResolvedBlockBase {
  type: "reviews";
  reviews: BioReview[];
  summary: {
    total: number;
    average: number;
  };
}

export type BioResolvedBlock =
  | BioResolvedHeroBlock
  | BioResolvedProductsBlock
  | BioResolvedCategoriesBlock
  | BioResolvedLinkBlock
  | BioResolvedReviewsBlock;

export interface BioPageData {
  workspaceId: string;
  config: BioPageConfig;
  blocks: BioResolvedBlock[];
  storeBaseUrl: string;
  publicUrl: string;
}

export interface BioEventInput {
  workspaceId: string;
  eventName: string;
  sessionId?: string | null;
  blockId?: string | null;
  blockType?: string | null;
  destinationUrl?: string | null;
  productId?: string | null;
  category?: string | null;
  campaignId?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  metadata?: Record<string, unknown> | null;
}
