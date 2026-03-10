import type { VndaProductRow } from "./vnda-api";
import type { GA4GenericRow } from "./ga4-api";

// --- Types ---

export type ProductClassification = "estrela" | "oportunidade" | "cash_cow" | "alerta";
export type ProductRecommendation = "aumentar_preco" | "manter_preco" | "reduzir_preco" | "promocionar";

export interface ProductIntelligence {
  name: string;
  // VNDA metrics
  revenue: number;
  unitsSold: number;
  avgPrice: number;
  percentOfTotal: number;
  // GA4 metrics
  views: number;
  addToCarts: number;
  ga4Purchases: number;
  ga4Revenue: number;
  // Computed
  conversionRate: number;
  cartAbandonmentRate: number;
  healthScore: number;
  classification: ProductClassification;
  recommendation: ProductRecommendation;
  recommendationReason: string;
  hasVndaData: boolean;
  hasGA4Data: boolean;
  // Source tracking
  sources: ("vnda" | "ga4")[];
}

export interface ProductComparison {
  name: string;
  prevRevenue: number;
  prevUnitsSold: number;
  prevViews: number;
  prevConversionRate: number;
  revenueDelta: number;
  unitsDelta: number;
  viewsDelta: number;
  conversionDelta: number;
  trend: "improving" | "stable" | "declining";
}

export interface ProductIntelligenceResponse {
  products: ProductIntelligence[];
  comparison?: ProductComparison[];
  summary: {
    totalProducts: number;
    totalRevenue: number;
    avgConversionRate: number;
    productsNeedingAttention: number;
    classificationCounts: Record<ProductClassification, number>;
    recommendationCounts: Record<ProductRecommendation, number>;
  };
  vndaConfigured: boolean;
  ga4Configured: boolean;
}

// --- Helpers ---

function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(a.split(" ").filter(Boolean));
  const tokensB = new Set(b.split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// --- Merge products from VNDA + GA4 ---

interface MergedRaw {
  name: string;
  revenue: number;
  unitsSold: number;
  avgPrice: number;
  percentOfTotal: number;
  views: number;
  addToCarts: number;
  ga4Purchases: number;
  ga4Revenue: number;
  hasVndaData: boolean;
  hasGA4Data: boolean;
}

function mergeProducts(
  vndaProducts: VndaProductRow[],
  ga4Products: GA4GenericRow[]
): MergedRaw[] {
  const merged = new Map<string, MergedRaw>();

  // Index VNDA products by normalized name
  for (const p of vndaProducts) {
    const key = normalizeProductName(p.name);
    merged.set(key, {
      name: p.name,
      revenue: p.revenue,
      unitsSold: p.quantity,
      avgPrice: p.avgPrice,
      percentOfTotal: p.percentOfTotal,
      views: 0,
      addToCarts: 0,
      ga4Purchases: 0,
      ga4Revenue: 0,
      hasVndaData: true,
      hasGA4Data: false,
    });
  }

  // Match GA4 products to VNDA
  for (const row of ga4Products) {
    const ga4Name = row.dimensions.itemName || "";
    if (!ga4Name) continue;
    const ga4Key = normalizeProductName(ga4Name);

    // Try exact match first
    let matched = merged.get(ga4Key);
    let matchedKey = ga4Key;

    // Fuzzy match if no exact match
    if (!matched) {
      let bestScore = 0;
      for (const [key, existing] of merged) {
        const score = tokenOverlap(ga4Key, key);
        if (score > bestScore && score >= 0.7) {
          bestScore = score;
          matched = existing;
          matchedKey = key;
        }
      }
    }

    if (matched) {
      matched.views += row.metrics.itemsViewed || 0;
      matched.addToCarts += row.metrics.itemsAddedToCart || 0;
      matched.ga4Purchases += row.metrics.itemsPurchased || 0;
      matched.ga4Revenue += row.metrics.itemRevenue || 0;
      matched.hasGA4Data = true;
      merged.set(matchedKey, matched);
    } else {
      // GA4-only product
      merged.set(ga4Key, {
        name: ga4Name,
        revenue: row.metrics.itemRevenue || 0,
        unitsSold: row.metrics.itemsPurchased || 0,
        avgPrice:
          row.metrics.itemsPurchased > 0
            ? (row.metrics.itemRevenue || 0) / row.metrics.itemsPurchased
            : 0,
        percentOfTotal: 0,
        views: row.metrics.itemsViewed || 0,
        addToCarts: row.metrics.itemsAddedToCart || 0,
        ga4Purchases: row.metrics.itemsPurchased || 0,
        ga4Revenue: row.metrics.itemRevenue || 0,
        hasVndaData: false,
        hasGA4Data: true,
      });
    }
  }

  return [...merged.values()];
}

// --- Scoring ---

function calculateHealthScore(
  product: MergedRaw,
  avgConvRate: number,
  medianRevenue: number
): number {
  let score = 0;
  const convRate =
    product.views > 0
      ? ((product.ga4Purchases || product.unitsSold) / product.views) * 100
      : 0;

  // Factor 1: Revenue (0-30)
  if (medianRevenue > 0) {
    score += Math.min(30, (product.revenue / medianRevenue) * 15);
  } else if (product.revenue > 0) {
    score += 15;
  }

  // Factor 2: Conversion rate vs average (0-30)
  if (avgConvRate > 0 && product.views > 0) {
    score += Math.min(30, (convRate / avgConvRate) * 15);
  } else if (product.unitsSold > 0) {
    score += 15;
  }

  // Factor 3: Sales velocity (0-20)
  if (product.views > 0) {
    const velocity = product.unitsSold / product.views;
    const normVelocity = velocity / ((avgConvRate / 100) || 0.01);
    score += Math.min(20, normVelocity * 10);
  } else if (product.unitsSold > 0) {
    score += 10;
  }

  // Factor 4: Cart completion (0-20)
  if (product.addToCarts > 0) {
    const completion =
      product.ga4Purchases > 0
        ? Math.min(1, product.ga4Purchases / product.addToCarts)
        : 0;
    score += completion * 20;
  } else if (product.unitsSold > 0) {
    score += 10;
  }

  return Math.round(Math.max(0, Math.min(100, score)));
}

// --- Classification ---

function classifyProduct(
  product: ProductIntelligence,
  avgConvRate: number,
  revenueP70: number,
  viewsMedian: number
): ProductClassification {
  const highRevenue = product.revenue >= revenueP70;
  const highConversion = product.conversionRate > avgConvRate;
  const highViews = product.views > viewsMedian;
  const lowConversion = product.conversionRate < avgConvRate * 0.7;

  if (highRevenue && highConversion) return "estrela";
  if (highViews && lowConversion) return "oportunidade";
  if (product.revenue > 0 && !lowConversion) return "cash_cow";
  return "alerta";
}

// --- Recommendation ---

function recommendAction(
  product: ProductIntelligence,
  avgConvRate: number,
  viewsMedian: number
): { recommendation: ProductRecommendation; reason: string } {
  const conv = product.conversionRate;
  const views = product.views;
  const cartAband = product.cartAbandonmentRate;

  if (conv > avgConvRate * 1.5 && product.unitsSold > 0) {
    return {
      recommendation: "aumentar_preco",
      reason: `Alta demanda com conversao de ${conv.toFixed(1)}% (media ${avgConvRate.toFixed(1)}%). Ha margem para aumento de preco.`,
    };
  }

  if (views > viewsMedian && conv < avgConvRate * 0.5 && cartAband > 0.5) {
    return {
      recommendation: "reduzir_preco",
      reason: `${views} visualizacoes mas apenas ${conv.toFixed(1)}% de conversao. ${(cartAband * 100).toFixed(0)}% de abandono de carrinho sugere preco elevado.`,
    };
  }

  if (views < viewsMedian && conv >= avgConvRate * 0.8 && product.unitsSold > 0) {
    return {
      recommendation: "promocionar",
      reason: `Boa conversao de ${conv.toFixed(1)}% mas apenas ${views} views. Investir em divulgacao pode aumentar vendas.`,
    };
  }

  return {
    recommendation: "manter_preco",
    reason: `Performance equilibrada com conversao de ${conv.toFixed(1)}%. Manter estrategia atual.`,
  };
}

// --- Main orchestrator ---

export function generateIntelligenceReport(args: {
  vndaProducts: VndaProductRow[];
  ga4Products: GA4GenericRow[];
  prevVndaProducts?: VndaProductRow[];
  prevGA4Products?: GA4GenericRow[];
}): ProductIntelligenceResponse {
  const rawMerged = mergeProducts(args.vndaProducts, args.ga4Products);

  // Calculate aggregates
  const revenues = rawMerged.map((p) => p.revenue).filter((r) => r > 0);
  const medianRev = median(revenues);
  const revenueP70 = percentile(revenues, 70);

  const viewsList = rawMerged.map((p) => p.views).filter((v) => v > 0);
  const viewsMed = median(viewsList);

  // Average conversion rate (only for products with views)
  const withViews = rawMerged.filter((p) => p.views > 0);
  const totalPurchases = withViews.reduce(
    (s, p) => s + (p.ga4Purchases || p.unitsSold),
    0
  );
  const totalViews = withViews.reduce((s, p) => s + p.views, 0);
  const avgConvRate = totalViews > 0 ? (totalPurchases / totalViews) * 100 : 0;

  // Build ProductIntelligence objects
  const products: ProductIntelligence[] = rawMerged.map((raw) => {
    const convRate =
      raw.views > 0
        ? ((raw.ga4Purchases || raw.unitsSold) / raw.views) * 100
        : 0;
    const cartAband =
      raw.addToCarts > 0
        ? Math.max(0, (raw.addToCarts - raw.ga4Purchases) / raw.addToCarts)
        : 0;
    const healthScore = calculateHealthScore(raw, avgConvRate, medianRev);

    const sources: ("vnda" | "ga4")[] = [];
    if (raw.hasVndaData) sources.push("vnda");
    if (raw.hasGA4Data) sources.push("ga4");

    const partial: ProductIntelligence = {
      name: raw.name,
      revenue: raw.revenue,
      unitsSold: raw.unitsSold,
      avgPrice: raw.avgPrice,
      percentOfTotal: raw.percentOfTotal,
      views: raw.views,
      addToCarts: raw.addToCarts,
      ga4Purchases: raw.ga4Purchases,
      ga4Revenue: raw.ga4Revenue,
      conversionRate: parseFloat(convRate.toFixed(2)),
      cartAbandonmentRate: parseFloat(cartAband.toFixed(4)),
      healthScore,
      classification: "cash_cow",
      recommendation: "manter_preco",
      recommendationReason: "",
      hasVndaData: raw.hasVndaData,
      hasGA4Data: raw.hasGA4Data,
      sources,
    };

    partial.classification = classifyProduct(
      partial,
      avgConvRate,
      revenueP70,
      viewsMed
    );
    const rec = recommendAction(partial, avgConvRate, viewsMed);
    partial.recommendation = rec.recommendation;
    partial.recommendationReason = rec.reason;

    return partial;
  });

  // Sort by revenue desc
  products.sort((a, b) => b.revenue - a.revenue);

  // Build comparison if previous period data exists
  let comparison: ProductComparison[] | undefined;
  if (args.prevVndaProducts || args.prevGA4Products) {
    const prevMerged = mergeProducts(
      args.prevVndaProducts || [],
      args.prevGA4Products || []
    );
    const prevMap = new Map<string, MergedRaw>();
    for (const p of prevMerged) {
      prevMap.set(normalizeProductName(p.name), p);
    }

    comparison = products
      .map((curr) => {
        const prev = prevMap.get(normalizeProductName(curr.name));
        if (!prev) return null;
        const prevConv =
          prev.views > 0
            ? ((prev.ga4Purchases || prev.unitsSold) / prev.views) * 100
            : 0;
        const revDelta =
          prev.revenue > 0
            ? ((curr.revenue - prev.revenue) / prev.revenue) * 100
            : curr.revenue > 0
              ? 100
              : 0;
        const unitsDelta =
          prev.unitsSold > 0
            ? ((curr.unitsSold - prev.unitsSold) / prev.unitsSold) * 100
            : 0;
        const viewsDelta =
          prev.views > 0
            ? ((curr.views - prev.views) / prev.views) * 100
            : 0;
        const convDelta = curr.conversionRate - prevConv;

        let trend: "improving" | "stable" | "declining" = "stable";
        if (revDelta > 10 || convDelta > 1) trend = "improving";
        else if (revDelta < -10 || convDelta < -1) trend = "declining";

        return {
          name: curr.name,
          prevRevenue: prev.revenue,
          prevUnitsSold: prev.unitsSold,
          prevViews: prev.views,
          prevConversionRate: parseFloat(prevConv.toFixed(2)),
          revenueDelta: parseFloat(revDelta.toFixed(1)),
          unitsDelta: parseFloat(unitsDelta.toFixed(1)),
          viewsDelta: parseFloat(viewsDelta.toFixed(1)),
          conversionDelta: parseFloat(convDelta.toFixed(2)),
          trend,
        } satisfies ProductComparison;
      })
      .filter(Boolean) as ProductComparison[];
  }

  // Summary
  const classificationCounts: Record<ProductClassification, number> = {
    estrela: 0,
    oportunidade: 0,
    cash_cow: 0,
    alerta: 0,
  };
  const recommendationCounts: Record<ProductRecommendation, number> = {
    aumentar_preco: 0,
    manter_preco: 0,
    reduzir_preco: 0,
    promocionar: 0,
  };
  for (const p of products) {
    classificationCounts[p.classification]++;
    recommendationCounts[p.recommendation]++;
  }

  return {
    products,
    comparison,
    summary: {
      totalProducts: products.length,
      totalRevenue: products.reduce((s, p) => s + p.revenue, 0),
      avgConversionRate: parseFloat(avgConvRate.toFixed(2)),
      productsNeedingAttention:
        classificationCounts.alerta + classificationCounts.oportunidade,
      classificationCounts,
      recommendationCounts,
    },
    vndaConfigured: false,
    ga4Configured: false,
  };
}
