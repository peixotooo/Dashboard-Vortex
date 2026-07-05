import { createAdminClient } from "@/lib/supabase-admin";
import { getRecommendations, type ShelfProduct } from "@/lib/shelves/algorithms";
import { getVndaConfigAdmin } from "@/lib/vnda-api";
import { resolveActiveCampaign } from "@/lib/topbar/resolve";
import { normalizeTopbarSlides } from "@/lib/topbar/slides";
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

const CATEGORY_DEFS: Array<{
  id: string;
  label: string;
  url: string;
  tag: string | null;
  patterns: string[];
}> = [
  {
    id: "combos",
    label: "Combos",
    url: "/combos",
    tag: "combos",
    patterns: ["combo", "leve", "kit"],
  },
  {
    id: "feminino",
    label: "Feminino",
    url: "/feminino",
    tag: "feminino",
    patterns: ["feminin", "cropped", "baby look"],
  },
  {
    id: "camisetas",
    label: "Camisetas",
    url: "/camisetas",
    tag: "camisetas",
    patterns: ["camiseta", "oversized", "t-shirt", "shirt"],
  },
  {
    id: "regatas",
    label: "Regatas",
    url: "/busca?q=regata",
    tag: "regatas",
    patterns: ["regata", "tank"],
  },
  {
    id: "lancamentos",
    label: "Lancamentos",
    url: "/lancamentos",
    tag: "lancamentos",
    patterns: ["lancamento", "new"],
  },
  {
    id: "mais-vendidos",
    label: "Mais vendidos",
    url: "/mais-vendidos",
    tag: null,
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
    .replace(/\s*\[(?=[^\]]*(?:Local|Processo|Entrega|Atendimento)\s*:)[\s\S]*?\]\s*$/gi, "")
    .replace(/(?:^|\s)(?:Local|Processo|Entrega|Atendimento)\s*:\s*[^|]+(?:\||$)/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\?{2,}/g, "")
    .trim();
}

function hasUsefulReviewText(comment: string): boolean {
  if (comment.length < 24) return false;
  if (/^(?:local|processo|entrega|atendimento)\s*:/i.test(comment)) return false;
  return /[a-zA-ZÀ-ÿ]{4,}/.test(comment);
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
  ctx: BioContext,
  block: BioBlockConfig
): Promise<BioResolvedBlock | null> {
  const algorithm = (block.algorithm || "bestsellers") as BioProductAlgorithm;
  const limit = Math.min(Math.max(Number(block.limit) || 6, 1), 12);
  let products: ShelfProduct[] = [];

  // Caminho rapido: mais vendidos via snapshot (sem hit na VNDA). "offers" pega o
  // proximo trecho do ranking ("continue explorando"), sem repetir os bestsellers.
  if (algorithm === "bestsellers" || algorithm === "offers") {
    try {
      products = await resolveSnapshotProducts(ctx, {
        limit,
        offset: algorithm === "offers" ? limit : 0,
      });
    } catch (error) {
      console.warn("[bio] snapshot products failed", block.id, error);
    }
  }

  // Fallback (snapshot ausente, ou outro algoritmo): recomendacao via VNDA.
  if (products.length === 0) {
    try {
      products = await getRecommendations({
        workspaceId: ctx.workspaceId,
        algorithm,
        limit,
        tags: block.tags,
        priceMin: typeof block.price_min === "number" ? block.price_min : undefined,
        priceMax: typeof block.price_max === "number" ? block.price_max : undefined,
      });
    } catch (error) {
      console.warn("[bio] recommendations failed", block.id, error);
    }
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

function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Acessorios nao servem de capa de categoria (ex.: manguito, meia, garrafa).
const ACCESSORY_RE = /manguito|munhequeira|\bmeia\b|garrafa|shaker|squeeze|caneca|\bbon[\u00e9e]\b|touca|\bfaixa\b|adesivo|gift\s?card|vale[-\s]presente/i;

// --- Contexto da bio: catalogo (shelf_products) + ranking ABC carregados UMA vez ---
// e compartilhados entre os blocos (mais vendidos, ofertas, capas de categoria),
// tudo no Supabase, SEM paginar a API de pedidos da VNDA no caminho quente.
type BioCatalogEntry = {
  product_id: string;
  name: string;
  image_url: string | null;
  image_url_2: string | null;
  product_url: string | null;
  created_at: string | null;
  tags: unknown;
};

function entryTagSet(entry: BioCatalogEntry): Set<string> {
  const set = new Set<string>();
  if (Array.isArray(entry.tags)) {
    for (const tag of entry.tags) {
      const name = String((tag as { name?: unknown })?.name || "").toLowerCase().trim();
      if (name) set.add(name);
    }
  }
  return set;
}

type BioSnapItem = { name: string; score: number };

type BioContext = {
  workspaceId: string;
  storeBaseUrl: string;
  snapshot: () => Promise<BioSnapItem[]>;
  catalog: () => Promise<Map<string, BioCatalogEntry>>;
};

// shelf_products (ativo + em estoque) indexado por nome normalizado.
async function loadCatalogMap(workspaceId: string): Promise<Map<string, BioCatalogEntry>> {
  const map = new Map<string, BioCatalogEntry>();
  const admin = createAdminClient();
  try {
    const { data } = await admin
      .from("shelf_products")
      .select("product_id, name, image_url, image_url_2, product_url, created_at, tags")
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .eq("in_stock", true)
      .not("image_url", "is", null)
      .range(0, 1999);
    for (const row of (data || []) as BioCatalogEntry[]) {
      const key = normalizeProductName(row.name || "");
      if (key && !map.has(key)) map.set(key, row);
    }
  } catch {
    // Catalogo e best-effort.
  }
  return map;
}

// Ranking de mais vendidos (snapshot ABC mais recente), em ordem de venda.
async function loadSnapshotRanking(workspaceId: string): Promise<BioSnapItem[]> {
  const admin = createAdminClient();
  try {
    const { data } = await admin
      .from("crm_abc_snapshots")
      .select("products")
      .eq("workspace_id", workspaceId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const products = Array.isArray(data?.products) ? (data.products as Array<Record<string, unknown>>) : [];
    return products
      .map((p) => ({
        name: String(p.name || ""),
        score: Number(p.revenue || 0) || Number(p.qty_sold || 0) || 1,
      }))
      .filter((p) => p.name)
      .sort((a, b) => b.score - a.score);
  } catch {
    return [];
  }
}

function createBioContext(workspaceId: string, storeBaseUrl: string): BioContext {
  let snapPromise: Promise<BioSnapItem[]> | null = null;
  let catPromise: Promise<Map<string, BioCatalogEntry>> | null = null;
  return {
    workspaceId,
    storeBaseUrl,
    snapshot: () => (snapPromise ||= loadSnapshotRanking(workspaceId)),
    catalog: () => (catPromise ||= loadCatalogMap(workspaceId)),
  };
}

// O permalink da VNDA e `/produto/{slug}-{id}`, mas shelf_products guarda só
// `/produto/{slug}` (sem o -id) -> 404 na loja (que joga pro home, perdendo UTM
// e a PDP). Garante o -{id} no fim do path.
function ensureVndaProductUrl(url: string | null, productId: string): string | null {
  if (!url || !productId) return url;
  try {
    const parsed = new URL(url);
    const suffix = `-${productId}`;
    if (!parsed.pathname.endsWith(suffix)) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "") + suffix;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function catalogEntryToShelf(entry: BioCatalogEntry): ShelfProduct {
  return {
    product_id: entry.product_id,
    name: entry.name,
    price: 0,
    sale_price: null,
    image_url: entry.image_url,
    image_url_2: entry.image_url_2,
    product_url: ensureVndaProductUrl(entry.product_url, entry.product_id),
    category: null,
    tags: null,
    in_stock: true,
  };
}

// Mais vendidos / "continue explorando" via snapshot + catalogo (sem hit na VNDA).
async function resolveSnapshotProducts(
  ctx: BioContext,
  opts: { limit: number; offset?: number }
): Promise<ShelfProduct[]> {
  const [ranking, catalog] = await Promise.all([ctx.snapshot(), ctx.catalog()]);
  const offset = opts.offset || 0;
  const out: ShelfProduct[] = [];
  const used = new Set<string>();
  for (const item of ranking) {
    const entry = catalog.get(normalizeProductName(item.name));
    if (!entry || used.has(entry.product_id)) continue;
    used.add(entry.product_id);
    out.push(catalogEntryToShelf(entry));
    if (out.length >= offset + opts.limit) break;
  }
  return out.slice(offset, offset + opts.limit);
}

async function getTrendingCategories(
  ctx: BioContext,
  storeBaseUrl: string,
  fallbackItems: BioCategoryItem[] = []
): Promise<BioCategoryItem[]> {
  const [ranking, catalog] = await Promise.all([ctx.snapshot(), ctx.catalog()]);
  const entries = [...catalog.values()];
  const scores = new Map<string, { score: number; count: number }>();
  const candByCat = new Map<string, BioSnapItem[]>();

  // ranking index (ordem de venda) por nome normalizado.
  const rankIndex = new Map<string, number>();
  ranking.forEach((item, index) => {
    const key = normalizeProductName(item.name);
    if (!rankIndex.has(key)) rankIndex.set(key, index);
  });
  const rankOf = (entry: BioCatalogEntry) =>
    rankIndex.get(normalizeProductName(entry.name)) ?? Number.MAX_SAFE_INTEGER;

  for (const item of ranking.slice(0, 200)) {
    const category = inferCategoryFromName(item.name);
    if (!category) continue;
    const current = scores.get(category.id) || { score: 0, count: 0 };
    current.score += item.score;
    current.count += 1;
    scores.set(category.id, current);
    const arr = candByCat.get(category.id) || [];
    arr.push(item);
    candByCat.set(category.id, arr);
  }

  // Pools por TAG (mais confiavel que o nome): feminino = colecao; lancamentos =
  // flag da loja (capa precisa ser um lancamento DE VERDADE — mais novo primeiro).
  const tagPool = (tag: string) => entries.filter((entry) => entryTagSet(entry).has(tag));
  const femininoPool = tagPool("feminino").sort((a, b) => rankOf(a) - rankOf(b));
  const lancPool = tagPool("lancamentos").sort(
    (a, b) =>
      (Date.parse(b.created_at || "") || 0) - (Date.parse(a.created_at || "") || 0) ||
      rankOf(a) - rankOf(b)
  );
  if (femininoPool.length) scores.set("feminino", { score: 1, count: femininoPool.length });
  if (lancPool.length) {
    const current = scores.get("lancamentos") || { score: 0, count: 0 };
    scores.set("lancamentos", { score: current.score, count: lancPool.length });
  }

  const generated = CATEGORY_DEFS.map((category, index) => {
    const score = scores.get(category.id);
    return {
      id: category.id,
      label: category.label,
      url: withStoreBase(category.url, storeBaseUrl),
      description: score?.count ? "Em alta agora" : undefined,
      metric: score?.count ? `${score.count} itens` : undefined,
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
  const finalItems = merged
    .filter((item) => {
      const key = item.id || item.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);

  // Capa = produto representativo da categoria, garantindo imagens DISTINTAS
  // (greedy). feminino/lancamentos puxam do pool por tag; demais do ranking de
  // vendas; fallback no proximo do ranking global ainda nao usado.
  const usedImg = new Set<string>();
  const pickFromEntries = (pool: BioCatalogEntry[]): string | null => {
    for (const entry of pool) {
      if (ACCESSORY_RE.test(entry.name)) continue;
      const img = entry.image_url || entry.image_url_2 || null;
      if (img && !usedImg.has(img)) {
        usedImg.add(img);
        return img;
      }
    }
    return null;
  };
  const pickFromNames = (candidates: BioSnapItem[]): string | null => {
    for (const candidate of candidates) {
      if (ACCESSORY_RE.test(candidate.name)) continue;
      const entry = catalog.get(normalizeProductName(candidate.name));
      const img = entry?.image_url || entry?.image_url_2 || null;
      if (img && !usedImg.has(img)) {
        usedImg.add(img);
        return img;
      }
    }
    return null;
  };

  return finalItems.map((item) => {
    let cover: string | null = null;
    if (item.id === "feminino") cover = pickFromEntries(femininoPool);
    else if (item.id === "lancamentos") cover = pickFromEntries(lancPool);
    else cover = pickFromNames(candByCat.get(item.id) || []);
    if (!cover) cover = pickFromNames(ranking);
    return { ...item, cover_image_url: cover };
  });
}

async function resolveCategoriesBlock(
  ctx: BioContext,
  block: BioBlockConfig,
  storeBaseUrl: string
): Promise<BioResolvedBlock | null> {
  const items = block.source === "automatic" || !block.items?.length
    ? await getTrendingCategories(ctx, storeBaseUrl, block.items || [])
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
      const campaign = active.campaign as typeof active.campaign & {
        slides?: unknown;
        title?: string | null;
        message?: string | null;
        name?: string | null;
        link_url?: string | null;
        link_label?: string | null;
        id?: string | null;
        countdown_label?: string | null;
        countdown_bg_color?: string | null;
        countdown_text_color?: string | null;
        countdown_font_weight?: string | null;
        countdown_padding?: string | null;
        countdown_border_radius?: string | null;
        accent_color?: string | null;
      };
      const slides = normalizeTopbarSlides(campaign.slides, campaign.title, campaign.message, {
        fallbackLinkUrl: campaign.link_url,
        fallbackLinkLabel: campaign.link_label,
      });
      const primary = slides[0];
      // Slides seguintes = pontos da oferta (explica a acao melhor que so o subtitulo).
      const benefits = slides
        .slice(1)
        .filter((slide) => slide?.title)
        .map((slide) => ({
          title: String(slide.title),
          message: slide.message ? String(slide.message) : undefined,
        }))
        .slice(0, 4);
      return {
        id: block.id,
        type: "hero",
        title: primary?.title || campaign.title || campaign.name || block.title,
        subtitle: primary?.message || block.subtitle,
        cta_label: primary?.link_label || campaign.link_label || block.cta_label || "Conferir agora",
        url: withStoreBase(primary?.link_url || campaign.link_url || block.url || "/combos", storeBaseUrl),
        badge: "Acao ativa",
        countdown_target: active.countdownTarget,
        countdown_label: campaign.countdown_label || "Acaba em",
        countdown_style: {
          bg: campaign.countdown_bg_color,
          text: campaign.countdown_text_color,
          fontWeight: campaign.countdown_font_weight,
          padding: campaign.countdown_padding,
          borderRadius: campaign.countdown_border_radius,
        },
        accent_color: campaign.accent_color || null,
        benefits,
        campaign_id: campaign.id,
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
      body: truncate(cleanReviewComment(review.comment), 130),
      author: displayName(review.author_name),
      date: review.created_at,
    }))
    .filter((review) => hasUsefulReviewText(review.body))
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

type GiftBarBenefit = {
  icon?: string;
  title?: string;
  enabled?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  link_label?: string;
};

function isBenefitLive(benefit: GiftBarBenefit, now: number): boolean {
  if (benefit.enabled === false) return false;
  const startsAt = benefit.starts_at ? Date.parse(benefit.starts_at) : null;
  const endsAt = benefit.ends_at ? Date.parse(benefit.ends_at) : null;
  if (startsAt && Number.isFinite(startsAt) && startsAt > now) return false;
  if (endsAt && Number.isFinite(endsAt) && endsAt < now) return false;
  return true;
}

// Benefícios PDP ("Nossos benefícios") — mesma fonte da PDP (gift_bar_configs),
// só os ativos/dentro do agendamento.
async function resolveBenefitsBlock(
  workspaceId: string,
  block: BioBlockConfig
): Promise<BioResolvedBlock | null> {
  const admin = createAdminClient();
  let raw: GiftBarBenefit[] = [];
  let title = block.title;
  try {
    const { data } = await admin
      .from("gift_bar_configs")
      .select("show_product_benefits, product_benefits, product_benefits_title")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (data?.show_product_benefits === false) return null;
    raw = Array.isArray(data?.product_benefits) ? (data.product_benefits as GiftBarBenefit[]) : [];
    if (data?.product_benefits_title) title = data.product_benefits_title;
  } catch {
    return null;
  }
  const now = Date.now();
  const items = raw
    .filter((benefit) => isBenefitLive(benefit, now))
    .map((benefit) => ({
      icon: String(benefit.icon || "info"),
      title: String(benefit.title || "").trim(),
      link_label: benefit.link_label ? String(benefit.link_label) : undefined,
    }))
    .filter((benefit) => benefit.title)
    .slice(0, 8);
  if (items.length === 0) return null;
  return { id: block.id, type: "benefits", title, items };
}

async function resolveBlock(
  ctx: BioContext,
  block: BioBlockConfig,
  storeBaseUrl: string
): Promise<BioResolvedBlock | null> {
  if (!block.enabled) return null;

  if (block.type === "hero") return resolveHeroBlock(ctx.workspaceId, block, storeBaseUrl);
  if (block.type === "products") return resolveProductsBlock(ctx, block);
  if (block.type === "categories") return resolveCategoriesBlock(ctx, block, storeBaseUrl);
  if (block.type === "benefits") return resolveBenefitsBlock(ctx.workspaceId, block);
  if (block.type === "reviews") {
    const result = await getReviews(ctx.workspaceId, Math.min(Math.max(Number(block.limit) || 5, 1), 8));
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

  const url =
    block.type === "group"
      ? await resolveGroupUrl(ctx.workspaceId, block)
      : block.type === "chat"
      ? block.url || "https://chat.bulking.com.br" // absoluto, não prefixa store base
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

  const ctx = createBioContext(resolved.workspaceId, storeBaseUrl);
  const settled = await Promise.allSettled(
    config.blocks.map((block) => resolveBlock(ctx, block, storeBaseUrl))
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
