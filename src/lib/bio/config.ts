import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  BIO_DEFAULT_PUBLIC_DOMAIN,
  BIO_DEFAULT_STORE_URL,
  BIO_DEFAULT_UTM_CAMPAIGN,
  BIO_THEME_DEFAULT,
  getDefaultBioConfig,
} from "@/lib/bio/defaults";
import type { BioBlockConfig, BioPageConfig, BioThemeConfig } from "@/lib/bio/types";

type BioConfigRow = {
  workspace_id: string;
  enabled: boolean | null;
  slug: string | null;
  public_domain: string | null;
  store_base_url: string | null;
  brand_name: string | null;
  headline: string | null;
  subtitle: string | null;
  avatar_url: string | null;
  default_utm_campaign: string | null;
  blocks: unknown;
  theme: unknown;
  updated_at: string | null;
};

function cleanText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function cleanUrl(value: unknown, fallback = ""): string {
  const raw = cleanText(value, fallback);
  return raw.replace(/\/$/, "");
}

function toPositiveInt(value: unknown, fallback: number, max = 24): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function normalizeTheme(value: unknown): BioThemeConfig {
  const raw = value && typeof value === "object" ? (value as Partial<BioThemeConfig>) : {};
  return {
    background: cleanText(raw.background, BIO_THEME_DEFAULT.background),
    foreground: cleanText(raw.foreground, BIO_THEME_DEFAULT.foreground),
    muted: cleanText(raw.muted, BIO_THEME_DEFAULT.muted),
    card: cleanText(raw.card, BIO_THEME_DEFAULT.card),
    border: cleanText(raw.border, BIO_THEME_DEFAULT.border),
    accent: cleanText(raw.accent, BIO_THEME_DEFAULT.accent),
    accentForeground: cleanText(raw.accentForeground, BIO_THEME_DEFAULT.accentForeground),
  };
}

export function normalizeBioBlocks(value: unknown): BioBlockConfig[] {
  const fallback = getDefaultBioConfig("").blocks;
  const source = Array.isArray(value) && value.length > 0 ? value : fallback;

  return source
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const type = cleanText(raw.type);
      if (!["hero", "products", "categories", "group", "club", "shipping", "reviews", "benefits"].includes(type)) {
        return null;
      }

      const id = cleanText(raw.id, `${type}-${index + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");

      const block: BioBlockConfig = {
        id: id || `${type}-${index + 1}`,
        type: type as BioBlockConfig["type"],
        enabled: raw.enabled !== false,
        title: cleanText(raw.title),
        subtitle: cleanText(raw.subtitle),
        cta_label: cleanText(raw.cta_label),
        url: cleanText(raw.url),
        source:
          raw.source === "active_topbar" || raw.source === "manual" || raw.source === "automatic"
            ? raw.source
            : undefined,
        pool_slug: cleanText(raw.pool_slug),
      };

      if (block.type === "products") {
        const algorithm = cleanText(raw.algorithm, "bestsellers");
        block.algorithm = [
          "bestsellers",
          "bestseller_camisetas",
          "offers",
          "news",
          "most_popular",
          "custom_tags",
          "price_range",
        ].includes(algorithm)
          ? (algorithm as BioBlockConfig["algorithm"])
          : "bestsellers";
        block.limit = toPositiveInt(raw.limit, 6, 12);
        block.tags = Array.isArray(raw.tags)
          ? raw.tags.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 8)
          : [];
        block.price_min = raw.price_min === null || raw.price_min === "" ? null : Number(raw.price_min);
        block.price_max = raw.price_max === null || raw.price_max === "" ? null : Number(raw.price_max);
      }

      if (block.type === "categories") {
        block.items = Array.isArray(raw.items)
          ? raw.items
              .map((entry, itemIndex) => {
                if (!entry || typeof entry !== "object") return null;
                const category = entry as Record<string, unknown>;
                const label = cleanText(category.label);
                const url = cleanText(category.url);
                if (!label || !url) return null;
                return {
                  id: cleanText(category.id, label)
                    .toLowerCase()
                    .replace(/[^a-z0-9_-]+/g, "-")
                    .replace(/^-+|-+$/g, "") || `category-${itemIndex + 1}`,
                  label,
                  url,
                  description: cleanText(category.description),
                  metric: cleanText(category.metric),
                };
              })
              .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
              .slice(0, 8)
          : [];
      }

      if (block.type === "reviews") {
        block.limit = toPositiveInt(raw.limit, 5, 8);
      }

      return block;
    })
    .filter((block): block is BioBlockConfig => Boolean(block));
}

export function normalizeBioConfig(row: Partial<BioConfigRow> | null, workspaceId: string): BioPageConfig {
  const fallback = getDefaultBioConfig(workspaceId);
  if (!row) return fallback;

  return {
    workspace_id: workspaceId,
    enabled: row.enabled !== false,
    slug: cleanText(row.slug, fallback.slug),
    public_domain: cleanText(row.public_domain, BIO_DEFAULT_PUBLIC_DOMAIN).toLowerCase(),
    store_base_url: cleanUrl(row.store_base_url, BIO_DEFAULT_STORE_URL),
    brand_name: cleanText(row.brand_name, fallback.brand_name),
    headline: cleanText(row.headline, fallback.headline),
    subtitle: cleanText(row.subtitle, fallback.subtitle),
    avatar_url: cleanText(row.avatar_url) || null,
    default_utm_campaign: cleanText(row.default_utm_campaign, BIO_DEFAULT_UTM_CAMPAIGN),
    blocks: normalizeBioBlocks(row.blocks),
    theme: normalizeTheme(row.theme),
    updated_at: row.updated_at || null,
  };
}

export function isMissingBioTable(error: unknown): boolean {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message || "")
    : String(error || "");
  return message.includes("bio_page_configs") || message.includes("bio_page_events") || message.includes("schema cache");
}

export async function getBioConfigByWorkspace(
  workspaceId: string,
  db: SupabaseClient = createAdminClient()
): Promise<BioPageConfig> {
  const { data, error } = await db
    .from("bio_page_configs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    if (isMissingBioTable(error)) return getDefaultBioConfig(workspaceId);
    throw new Error(error.message);
  }

  return normalizeBioConfig(data as BioConfigRow | null, workspaceId);
}

export async function getBioConfigByDomain(
  host: string,
  db: SupabaseClient = createAdminClient()
): Promise<BioPageConfig | null> {
  const normalizedHost = host.toLowerCase().replace(/:\d+$/, "");
  const { data, error } = await db
    .from("bio_page_configs")
    .select("*")
    .eq("public_domain", normalizedHost)
    .eq("enabled", true)
    .maybeSingle();

  if (error) {
    if (isMissingBioTable(error)) return null;
    throw new Error(error.message);
  }

  if (!data?.workspace_id) return null;
  return normalizeBioConfig(data as BioConfigRow, data.workspace_id as string);
}

export async function upsertBioConfig(
  workspaceId: string,
  input: Partial<BioPageConfig>,
  db: SupabaseClient = createAdminClient()
): Promise<BioPageConfig> {
  const current = await getBioConfigByWorkspace(workspaceId, db);
  const next = normalizeBioConfig(
    {
      ...current,
      ...input,
      workspace_id: workspaceId,
      blocks: input.blocks || current.blocks,
      theme: input.theme || current.theme,
    },
    workspaceId
  );

  const { data, error } = await db
    .from("bio_page_configs")
    .upsert(
      {
        workspace_id: workspaceId,
        enabled: next.enabled,
        slug: next.slug,
        public_domain: next.public_domain,
        store_base_url: next.store_base_url,
        brand_name: next.brand_name,
        headline: next.headline,
        subtitle: next.subtitle,
        avatar_url: next.avatar_url,
        default_utm_campaign: next.default_utm_campaign,
        blocks: next.blocks,
        theme: next.theme,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return normalizeBioConfig(data as BioConfigRow, workspaceId);
}
