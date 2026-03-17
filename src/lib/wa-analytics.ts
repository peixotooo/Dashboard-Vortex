/**
 * WhatsApp Analytics — Real cost tracking via Meta Graph API
 *
 * Two endpoints:
 * - pricing_analytics: aggregate volume/cost by WABA (monthly spend)
 * - template_analytics: per-template metrics with real USD cost (campaign ROI)
 *
 * Reference: /Users/guilhermepeixoto/Downloads/WHATSAPP_ANALYTICS_PRICING_MANUAL_1.md
 */

const API_VERSION = "v21.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

// Brazil rates (USD) — effective Jan 2026
const BRAZIL_RATES: Record<string, number> = {
  MARKETING: 0.0625,
  UTILITY: 0.008,
  AUTHENTICATION: 0.0315,
  SERVICE: 0,
};

// --- Types ---

export interface PricingDataPoint {
  start: number;
  end: number;
  volume: number;
  pricing_category?: string;
  pricing_type?: string;
  country?: string;
  tier?: string;
}

export interface PricingAnalyticsResult {
  dataPoints: PricingDataPoint[];
  totalUsd: number;
  totalBrl: number;
  breakdown: Array<{
    category: string;
    type: string;
    volume: number;
    costUsd: number;
    costBrl: number;
  }>;
}

export interface TemplateDataPoint {
  start: number;
  end: number;
  sent: number;
  delivered: number;
  read: number;
  cost: number;
  clicked: number;
}

export interface TemplateMetrics {
  templateId: string;
  sent: number;
  delivered: number;
  read: number;
  costUsd: number;
  clicked: number;
  deliveryRate: number;
  openRate: number;
  ctr: number;
  costPerDelivery: number;
}

// --- Pricing Analytics ---

export async function getPricingAnalytics(
  wabaId: string,
  accessToken: string,
  opts: {
    startTimestamp: number;
    endTimestamp: number;
    granularity?: "DAILY" | "MONTHLY";
    phoneNumbers?: string[];
    dimensions?: string[];
  }
): Promise<PricingAnalyticsResult> {
  const {
    startTimestamp,
    endTimestamp,
    granularity = "MONTHLY",
    phoneNumbers = [],
    dimensions = ["PRICING_CATEGORY", "PRICING_TYPE"],
  } = opts;

  let field = `pricing_analytics.start(${startTimestamp}).end(${endTimestamp}).granularity(${granularity})`;
  if (phoneNumbers.length > 0) {
    field += `.phone_numbers(${JSON.stringify(phoneNumbers)})`;
  }
  if (dimensions.length > 0) {
    field += `.dimensions(${JSON.stringify(dimensions)})`;
  }

  const url = new URL(`${BASE_URL}/${wabaId}`);
  url.searchParams.set("fields", field);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[WA Analytics] pricing_analytics ${res.status}:`, text.slice(0, 500));
    throw new Error(`Meta pricing_analytics ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  const dataPoints: PricingDataPoint[] =
    json.pricing_analytics?.data?.[0]?.data_points || [];

  console.log(`[WA Analytics] pricing_analytics wabaId=${wabaId} dataPoints=${dataPoints.length}`, JSON.stringify(dataPoints).slice(0, 500));

  return computeCostBreakdown(dataPoints);
}

function computeCostBreakdown(
  dataPoints: PricingDataPoint[],
  exchangeRate = 5.8
): PricingAnalyticsResult {
  let totalUsd = 0;
  const breakdown: PricingAnalyticsResult["breakdown"] = [];

  for (const dp of dataPoints) {
    const category = dp.pricing_category || "UNKNOWN";
    const type = dp.pricing_type || "REGULAR";
    const volume = dp.volume || 0;

    let costUsd = 0;
    if (type === "REGULAR" && BRAZIL_RATES[category] !== undefined) {
      costUsd = volume * BRAZIL_RATES[category];
    }
    // FREE_CUSTOMER_SERVICE and FREE_ENTRY_POINT = $0

    totalUsd += costUsd;
    breakdown.push({
      category,
      type,
      volume,
      costUsd: round2(costUsd),
      costBrl: round2(costUsd * exchangeRate),
    });
  }

  return {
    dataPoints,
    totalUsd: round2(totalUsd),
    totalBrl: round2(totalUsd * exchangeRate),
    breakdown,
  };
}

// --- Template Analytics ---

export async function getTemplateAnalytics(
  wabaId: string,
  accessToken: string,
  opts: {
    startTimestamp: number;
    endTimestamp: number;
    templateIds?: number[];
    metricTypes?: string[];
  }
): Promise<TemplateMetrics[]> {
  const {
    startTimestamp,
    endTimestamp,
    templateIds = [],
    metricTypes = ["SENT", "DELIVERED", "READ", "COST", "CLICKED"],
  } = opts;

  let field = `template_analytics.start(${startTimestamp}).end(${endTimestamp}).granularity(DAILY)`;
  if (templateIds.length > 0) {
    field += `.template_ids(${JSON.stringify(templateIds)})`;
  }
  if (metricTypes.length > 0) {
    field += `.metric_types(${JSON.stringify(metricTypes)})`;
  }

  const url = new URL(`${BASE_URL}/${wabaId}`);
  url.searchParams.set("fields", field);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[WA Analytics] template_analytics ${res.status}:`, text.slice(0, 500));
    throw new Error(`Meta template_analytics ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  const templates = json.template_analytics?.data || [];
  console.log(`[WA Analytics] template_analytics wabaId=${wabaId} templates=${templates.length}`, JSON.stringify(templates).slice(0, 500));

  return templates.map(
    (t: { template_id: string; data_points: TemplateDataPoint[] }) => {
      let totalSent = 0,
        totalDelivered = 0,
        totalRead = 0,
        totalCost = 0,
        totalClicked = 0;

      for (const dp of t.data_points || []) {
        totalSent += dp.sent || 0;
        totalDelivered += dp.delivered || 0;
        totalRead += dp.read || 0;
        totalCost += dp.cost || 0;
        totalClicked += dp.clicked || 0;
      }

      return {
        templateId: t.template_id,
        sent: totalSent,
        delivered: totalDelivered,
        read: totalRead,
        costUsd: round2(totalCost),
        clicked: totalClicked,
        deliveryRate: totalSent > 0 ? round2((totalDelivered / totalSent) * 100) : 0,
        openRate: totalDelivered > 0 ? round2((totalRead / totalDelivered) * 100) : 0,
        ctr: totalDelivered > 0 ? round2((totalClicked / totalDelivered) * 100) : 0,
        costPerDelivery: totalDelivered > 0 ? round4(totalCost / totalDelivered) : 0,
      };
    }
  );
}

// --- Monthly Spend Summary ---

export async function getMonthlySpendSummary(
  wabaId: string,
  accessToken: string,
  opts?: { year?: number; month?: number; exchangeRate?: number }
): Promise<PricingAnalyticsResult & { period: { start: string; end: string } }> {
  const now = new Date();
  const year = opts?.year ?? now.getFullYear();
  const month = opts?.month ?? now.getMonth() + 1;

  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59));

  const startTs = Math.floor(startDate.getTime() / 1000);
  const endTs = Math.floor(endDate.getTime() / 1000);

  const result = await getPricingAnalytics(wabaId, accessToken, {
    startTimestamp: startTs,
    endTimestamp: endTs,
    granularity: "MONTHLY",
    dimensions: ["PRICING_CATEGORY", "PRICING_TYPE"],
  });

  // Recompute with custom exchange rate if provided
  if (opts?.exchangeRate && opts.exchangeRate !== 5.8) {
    const recomputed = computeCostBreakdown(result.dataPoints, opts.exchangeRate);
    return {
      ...recomputed,
      period: {
        start: startDate.toISOString().slice(0, 10),
        end: endDate.toISOString().slice(0, 10),
      },
    };
  }

  return {
    ...result,
    period: {
      start: startDate.toISOString().slice(0, 10),
      end: endDate.toISOString().slice(0, 10),
    },
  };
}

// --- Helpers ---

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function toTimestamp(dateString: string): number {
  return Math.floor(new Date(dateString).getTime() / 1000);
}
