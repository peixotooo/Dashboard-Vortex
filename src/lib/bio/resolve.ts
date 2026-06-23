import { createAdminClient } from "@/lib/supabase-admin";
import { getRecommendations, type ShelfProduct } from "@/lib/shelves/algorithms";
import { getVndaConfigAdmin } from "@/lib/vnda-api";
import { resolveActiveCampaign } from "@/lib/topbar/resolve";
import { listGroupPools } from "@/lib/whatsapp/group-pools";
import { BIO_DEFAULT_PUBLIC_DOMAIN, BIO_DEFAULT_STORE_URL, getDefaultBioConfig } from "@/lib/bio/defaults";
import { getBioConfigByDomain, getBioConfigByWorkspace, isMissingBioTable } from "@/lib/bio/config";
import type {
  BioBlockConfig,
  BioCategoryItem,
  BioPageConfig,
  BioPageData,
  BioProductAlgorithm,
  BioResolvedBlock,
  BioReview,
} from "@/lib/bio/types";

type WorkspaceRow = {
  id: string;
  slug: string;
  name: string;
  custom_domain?: string | null;
};

type StoreReviewRow = {
  id: string;
  rating: number | string | null;
  comment: string | null;
  author_name: string | null;
  created_at: string | null;
};

const CATEGORY_DEFS = [
  {
    id: "combos",
    label: "Combos",
    url: "/combos",
    patterns: ["combo", "leve", "kit"],
  },
  {
    id: "camisetas",
    label: "Camisetas",
    url: "/camisetas",
    patterns: ["camiseta", "oversized", "t-shirt", "shirt"],
  },
  {
    id: "regatas",
    label: "Regatas",
    url: "/busca?q=regata",
    patterns: ["regata", "tank"],
  },
  {
    id: "lancamentos",
    label: "Lancamentos",
    url: "/lancamentos",
    patterns: ["lancamento", "new"],
  },
  {
    id: "mais-vendidos",
    label: "Mais vendidos",
    url: "/mais-vendidos",
    patterns: ["camiseta", "regata", "combo"],
  },
];

function normalizeHost(host: string): string {
  return host.split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
}

function withStoreBase(url: string, storeBaseUrl: string): string {
  if (!url) return storeBaseUrl;
  if (/^https?:\/\//i.test(url)) return url;
  return `${storeBaseUrl}${url.startsWith("/") ? url : `/${url}`}`;
}

function displayName(name: string | null): string {
  if (!name) return "Cliente Bulking";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || "Cliente Bulking";
  return `${parts[0]} ${parts[1][0].toUpperCase()}.`;
}

function cleanReviewComment(comment: string | null): string {
  return (comment || "")
    .replace(/\s+/g, " ")
    .replace(/\?{2,}/g, "")
    .trim();
}

function truncate(text: string, max = 164): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}...`;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithSeed<T>(items: T[], seed: string): T[] {
  const random = seededRandom(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function findDefaultWorkspace(host: string): Promise<WorkspaceRow | null> {
  const admin = createAdminClient();
  const envWorkspaceId = process.env.BIO_WORKSPACE_ID || process.env.DEFAULT_WORKSPACE_ID;
  if (envWorkspaceId) {
    const { data } = await admin
      .from("workspaces")
      .select("id, slug, name, custom_domain")
      .eq("id", envWorkspaceId)
      .maybeSingle();
    if (data) return data as WorkspaceRow;
  }

  const normalizedHost = normalizeHost(host);
  if (normalizedHost) {
    const { data } = await admin
      .from("workspaces")
      .select("id, slug, name, custom_domain")
      .eq("custom_domain", normalizedHost)
      .maybeSingle();
    if (data) return data as WorkspaceRow;
  }

  const { data: bulking } = await admin
    .from("workspaces")
    .select("id, slug, name, custom_domain")
    .eq("slug", "bulking")
    .maybeSingle();
  if (bulking) return bulking as WorkspaceRow;

  const { data: first } = await admin
    .from("workspaces")
    .select("id, slug, name, custom_domain")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (first as WorkspaceRow | null) || null;
}

async function findConfigByAnyHost(host: string): Promise<BioPageConfig | null> {
  try {
    const config = await getBioConfigByDomain(host);
    if (config) return config;
  } catch {
    return null;
  }
  return null;
}

async function getStoreBaseUrl(workspaceId: string, config: BioPageConfig): Promise<string> {
  if (config.store_base_url) return config.store_base_url.replace(/\/$/, "");
  const vnda = await getVndaConfigAdmin(workspaceId).catch(() => null);
  if (vnda?.storeHost) return `https://${vnda.storeHost}`.replace(/\/$/, "");
  return BIO_DEFAULT_STORE_URL;
}

async function resolveWorkspaceAndConfig(host: string): Promise<{ workspaceId: string; config: BioPageConfig } | null> {
  const byDomain = await findConfigByAnyHost(normalizeHost(host));
  if (byDomain) {
    return { workspaceId: byDomain.workspace_id, config: byDomain };
  }

  const workspace = await findDefaultWorkspace(host);
  if (!workspace?.id) return null;

  const config = await getBioConfigByWorkspace(workspace.id);
  return { workspaceId: workspace.id, config };
}

async function resolveProductsBlock(
  workspaceId: string,
  block: BioBlockConfig
): Promise<BioResolvedBlock | null> {
  const algorithm = (block.algorithm || "bestsellers") as BioProductAlgorithm;
  const limit = Math.min(Math.max(Number(block.limit) || 6, 1), 12);
  let products: ShelfProduct[] = [];

  try {
    products = await getRecommendations({
      workspaceId,
      algorithm,
      limit,
      tags: block.tags,
      priceMin: typeof block.price_min === "number" ? block.price_min : undefined,
      priceMax: typeof block.price_max === "number" ? block.price_max : undefined,
    });
  } catch (error) {
    console.warn("[bio] recommendations failed", block.id, error);
  }

  if (products.length === 0) return null;

  return {
    id: block.id,
    type: "products",
    title: block.title,
    subtitle: block.subtitle,
    cta_label: block.cta_label,
    url: block.url,
    algorithm,
    products: products.slice(0, limit),
  };
}

function inferCategoryFromName(name: string): (typeof CATEGORY_DEFS)[number] | null {
  const normalized = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return CATEGORY_DEFS.find((category) =>
    category.patterns.some((pattern) => normalized.includes(pattern))
  ) || null;
}

async function getTrendingCategories(
  workspaceId: string,
  storeBaseUrl: string,
  fallbackItems: BioCategoryItem[] = []
): Promise<BioCategoryItem[]> {
  const admin = createAdminClient();
  const scores = new Map<string, { score: number; count: number }>();

  try {
    const { data } = await admin
      .from("crm_abc_snapshots")
      .select("products")
      .eq("workspace_id", workspaceId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const products = Array.isArray(data?.products) ? data.products as Array<Record<string, unknown>> : [];
    for (const product of products.slice(0, 120)) {
      const name = String(product.name || "");
      const category = inferCategoryFromName(name);
      if (!category) continue;
      const current = scores.get(category.id) || { score: 0, count: 0 };
      current.score += Number(product.revenue || 0) || Number(product.qty_sold || 0) || 1;
      current.count += 1;
      scores.set(category.id, current);
    }
  } catch {
    // ABC can be absent in fresh workspaces.
  }

  const generated = CATEGORY_DEFS.map((category, index) => {
    const score = scores.get(category.id);
    return {
      id: category.id,
      label: category.label,
      url: withStoreBase(category.url, storeBaseUrl),
      description: score?.count ? `${score.count} produtos com tracao` : undefined,
      metric: score?.score ? `R$ ${Math.round(score.score).toLocaleString("pt-BR")}` : undefined,
      weight: score?.score || CATEGORY_DEFS.length - index,
    };
  })
    .sort((a, b) => b.weight - a.weight)
    .map(({ weight: _weight, ...item }) => item);

  const manual = fallbackItems
    .filter((item) => item.label && item.url)
    .map((item) => ({
      ...item,
      url: withStoreBase(item.url, storeBaseUrl),
    }));

  const merged = [...generated, ...manual];
  const seen = new Set<string>();
  return merged
    .filter((item) => {
      const key = item.id || item.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

async function resolveCategoriesBlock(
  workspaceId: string,
  block: BioBlockConfig,
  storeBaseUrl: string
): Promise<BioResolvedBlock | null> {
  const items = block.source === "automatic" || !block.items?.length
    ? await getTrendingCategories(workspaceId, storeBaseUrl, block.items || [])
    : block.items.map((item) => ({ ...item, url: withStoreBase(item.url, storeBaseUrl) })).slice(0, 8);

  if (items.length === 0) return null;
  return {
    id: block.id,
    type: "categories",
    title: block.title,
    subtitle: block.subtitle,
    cta_label: block.cta_label,
    url: block.url,
    items,
  };
}

async function resolveHeroBlock(
  workspaceId: string,
  block: BioBlockConfig,
  storeBaseUrl: string
): Promise<BioResolvedBlock> {
  if (block.source === "active_topbar") {
    const active = await resolveActiveCampaign(workspaceId, "bio").catch(() => null);
    if (active?.campaign) {
      return {
        id: block.id,
        type: "hero",
        title: active.campaign.title || active.campaign.name || block.title,
        subtitle: active.campaign.message || block.subtitle,
        cta_label: active.campaign.link_label || block.cta_label || "Conferir agora",
        url: withStoreBase(active.campaign.link_url || block.url || "/combos", storeBaseUrl),
        badge: "Acao ativa",
        countdown_target: active.countdownTarget,
        campaign_id: active.campaign.id,
      };
    }
  }

  return {
    id: block.id,
    type: "hero",
    title: block.title,
    subtitle: block.subtitle,
    cta_label: block.cta_label,
    url: withStoreBase(block.url || "/combos", storeBaseUrl),
    badge: "Link da bio",
    countdown_target: null,
    campaign_id: null,
  };
}

async function resolveGroupUrl(workspaceId: string, block: BioBlockConfig): Promise<string> {
  if (block.url) return block.url;
  try {
    const pools = await listGroupPools(createAdminClient(), workspaceId, "https://dash.bulking.com.br");
    const pool = pools.find((item) => item.slug === (block.pool_slug || "vip")) || pools[0];
    if (pool?.publicUrl) return pool.publicUrl;
  } catch {
    // Fallback below.
  }
  return "https://grupos.bulking.com.br";
}

async function getReviews(workspaceId: string, limit: number): Promise<{ reviews: BioReview[]; total: number; average: number }> {
  const admin = createAdminClient();
  const totalResult = await admin
    .from("store_reviews")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "published")
    .gte("rating", 4);

  if (totalResult.error) {
    if (isMissingBioTable(totalResult.error)) return { reviews: [], total: 0, average: 0 };
    return { reviews: [], total: 0, average: 0 };
  }

  const { data, error } = await admin
    .from("store_reviews")
    .select("id, rating, comment, author_name, created_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "published")
    .gte("rating", 4)
    .not("comment", "is", null)
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(Math.max(limit * 5, 16), 50));

  if (error) return { reviews: [], total: totalResult.count || 0, average: 4.7 };

  const seed = `${workspaceId}:${Math.floor(Date.now() / 300_000)}`;
  const reviews = shuffleWithSeed((data || []) as StoreReviewRow[], seed)
    .map((review) => ({
      id: review.id,
      rating: Number(review.rating) || 5,
      body: truncate(cleanReviewComment(review.comment)),
      author: displayName(review.author_name),
      date: review.created_at,
    }))
    .filter((review) => review.body.length >= 20)
    .slice(0, limit);

  const average = reviews.length
    ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
    : 4.7;

  return {
    reviews,
    total: totalResult.count || reviews.length,
    average: Math.max(4.7, Math.min(5, Number(average.toFixed(1)))),
  };
}

async function resolveBlock(
  workspaceId: string,
  block: BioBlockConfig,
  storeBaseUrl: string
): Promise<BioResolvedBlock | null> {
  if (!block.enabled) return null;

  if (block.type === "hero") return resolveHeroBlock(workspaceId, block, storeBaseUrl);
  if (block.type === "products") return resolveProductsBlock(workspaceId, block);
  if (block.type === "categories") return resolveCategoriesBlock(workspaceId, block, storeBaseUrl);
  if (block.type === "reviews") {
    const result = await getReviews(workspaceId, Math.min(Math.max(Number(block.limit) || 5, 1), 8));
    if (result.reviews.length === 0) return null;
    return {
      id: block.id,
      type: "reviews",
      title: block.title,
      subtitle: block.subtitle,
      reviews: result.reviews,
      summary: { total: result.total, average: result.average },
    };
  }

  const url = block.type === "group"
    ? await resolveGroupUrl(workspaceId, block)
    : withStoreBase(block.url || "/", storeBaseUrl);

  return {
    id: block.id,
    type: block.type,
    title: block.title,
    subtitle: block.subtitle,
    cta_label: block.cta_label,
    url,
  };
}

export async function resolveBioPageData(host: string): Promise<BioPageData | null> {
  const resolved = await resolveWorkspaceAndConfig(host);
  if (!resolved) return null;

  const storeBaseUrl = await getStoreBaseUrl(resolved.workspaceId, resolved.config);
  const config: BioPageConfig = {
    ...getDefaultBioConfig(resolved.workspaceId),
    ...resolved.config,
    store_base_url: storeBaseUrl,
  };

  if (!config.enabled) {
    return {
      workspaceId: resolved.workspaceId,
      config,
      blocks: [],
      storeBaseUrl,
      publicUrl: `https://${config.public_domain || BIO_DEFAULT_PUBLIC_DOMAIN}`,
    };
  }

  const settled = await Promise.allSettled(
    config.blocks.map((block) => resolveBlock(resolved.workspaceId, block, storeBaseUrl))
  );
  const blocks = settled
    .map((result) => (result.status === "fulfilled" ? result.value : null))
    .filter((block): block is BioResolvedBlock => Boolean(block));

  return {
    workspaceId: resolved.workspaceId,
    config,
    blocks,
    storeBaseUrl,
    publicUrl: `https://${config.public_domain || BIO_DEFAULT_PUBLIC_DOMAIN}`,
  };
}
