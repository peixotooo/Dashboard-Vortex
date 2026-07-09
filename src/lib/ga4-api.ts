import { BetaAnalyticsDataClient } from "@google-analytics/data";

// --- Client singleton ---

let _client: BetaAnalyticsDataClient | null = null;

function getClient(): BetaAnalyticsDataClient {
  if (_client) return _client;

  const credentialsJson = process.env.GA4_CREDENTIALS_JSON?.trim();
  if (credentialsJson) {
    let credentials;
    try {
      credentials = JSON.parse(credentialsJson);
    } catch {
      // Env vars may convert \n escapes in private_key to actual newlines,
      // which breaks JSON.parse. Replace them back to escape sequences.
      credentials = JSON.parse(credentialsJson.replace(/\n/g, "\\n"));
    }
    // Ensure private_key has actual newline characters (PEM format requirement)
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    }
    _client = new BetaAnalyticsDataClient({ credentials });
  } else {
    // Falls back to GOOGLE_APPLICATION_CREDENTIALS env var (file path)
    _client = new BetaAnalyticsDataClient();
  }

  return _client;
}

function getPropertyId(): string {
  const id = process.env.GA4_PROPERTY_ID;
  if (!id) throw new Error("GA4_PROPERTY_ID not configured");
  return id;
}

// --- Types ---

export interface GA4DailyRow {
  date: string; // DD/MM format (Brazilian standard)
  dateRaw: string; // YYYYMMDD
  sessions: number;
  users: number;
  newUsers: number;
  transactions: number;
  revenue: number;
  pageViews: number;
  addToCarts: number;
  checkouts: number;
}

export interface GA4Report {
  insights: GA4DailyRow[];
  totals: {
    sessions: number;
    users: number;
    newUsers: number;
    transactions: number;
    revenue: number;
    pageViews: number;
    addToCarts: number;
    checkouts: number;
  };
}

export interface GoogleAdsDailyRow {
  date: string;       // DD/MM
  dateRaw: string;    // YYYYMMDD
  cost: number;
  clicks: number;
  impressions: number;
}

export interface GoogleAdsTotals {
  cost: number;
  clicks: number;
  impressions: number;
  cpc: number;
  ctr: number;
}

export interface GoogleAdsReport {
  daily: GoogleAdsDailyRow[];
  totals: GoogleAdsTotals;
}

// --- Date helpers ---

function datePresetToRange(preset: string): { startDate: string; endDate: string } {
  switch (preset) {
    case "today":
      return { startDate: "today", endDate: "today" };
    case "yesterday":
      return { startDate: "yesterday", endDate: "yesterday" };
    case "last_7d":
      return { startDate: "7daysAgo", endDate: "today" };
    case "last_14d":
      return { startDate: "14daysAgo", endDate: "today" };
    case "last_30d":
      return { startDate: "30daysAgo", endDate: "today" };
    case "last_90d":
      return { startDate: "90daysAgo", endDate: "today" };
    case "this_month": {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      return {
        startDate: firstDay.toISOString().slice(0, 10),
        endDate: "today",
      };
    }
    case "last_month": {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        startDate: firstDay.toISOString().slice(0, 10),
        endDate: lastDay.toISOString().slice(0, 10),
      };
    }
    default:
      return { startDate: "30daysAgo", endDate: "today" };
  }
}

// Convert YYYYMMDD to DD/MM (Brazilian format)
function formatDate(yyyymmdd: string): string {
  const month = yyyymmdd.slice(4, 6);
  const day = yyyymmdd.slice(6, 8);
  return `${day}/${month}`;
}

type RunReportRequest = Parameters<BetaAnalyticsDataClient["runReport"]>[0];

async function runReportWithRetry(
  client: BetaAnalyticsDataClient,
  request: RunReportRequest,
  label: string,
  attempts = 2
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await client.runReport(request);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${label} failed: ${message}`);
}

function createEmptyGA4Row(dateRaw: string): GA4DailyRow {
  return {
    date: formatDate(dateRaw),
    dateRaw,
    sessions: 0,
    users: 0,
    newUsers: 0,
    transactions: 0,
    revenue: 0,
    pageViews: 0,
    addToCarts: 0,
    checkouts: 0,
  };
}

// --- Main function ---

export async function getGA4DailyReport(args: {
  propertyId?: string;
  datePreset?: string;
  startDate?: string;
  endDate?: string;
}): Promise<GA4Report> {
  const client = getClient();
  const propertyId = args.propertyId || getPropertyId();

  const range = args.startDate && args.endDate
    ? { startDate: args.startDate, endDate: args.endDate }
    : datePresetToRange(args.datePreset || "last_30d");

  const [trafficResponse] = await runReportWithRetry(client, {
    property: `properties/${propertyId}`,
    dimensions: [{ name: "date" }],
    metrics: [
      { name: "sessions" },
      { name: "totalUsers" },
      { name: "newUsers" },
      { name: "screenPageViews" },
    ],
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    orderBys: [{ dimension: { dimensionName: "date", orderType: "NUMERIC" }, desc: false }],
  }, "GA4 traffic report");

  const ecommerceResult = await runReportWithRetry(client, {
    property: `properties/${propertyId}`,
    dimensions: [{ name: "date" }],
    metrics: [
      { name: "transactions" },
      { name: "purchaseRevenue" },
      { name: "addToCarts" },
      { name: "checkouts" },
    ],
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    orderBys: [{ dimension: { dimensionName: "date", orderType: "NUMERIC" }, desc: false }],
  }, "GA4 ecommerce report").catch((error) => {
    console.warn("[GA4] ecommerce metrics unavailable:", error instanceof Error ? error.message : error);
    return null;
  });

  const byDate = new Map<string, GA4DailyRow>();
  const totals = {
    sessions: 0,
    users: 0,
    newUsers: 0,
    transactions: 0,
    revenue: 0,
    pageViews: 0,
    addToCarts: 0,
    checkouts: 0,
  };

  for (const row of trafficResponse.rows || []) {
    const dateRaw = row.dimensionValues?.[0]?.value || "";
    const sessions = parseInt(row.metricValues?.[0]?.value || "0", 10);
    const users = parseInt(row.metricValues?.[1]?.value || "0", 10);
    const newUsers = parseInt(row.metricValues?.[2]?.value || "0", 10);
    const pageViews = parseInt(row.metricValues?.[3]?.value || "0", 10);
    if (!dateRaw) continue;

    byDate.set(dateRaw, {
      ...createEmptyGA4Row(dateRaw),
      sessions,
      users,
      newUsers,
      pageViews,
    });
    totals.sessions += sessions;
    totals.users += users;
    totals.newUsers += newUsers;
    totals.pageViews += pageViews;
  }

  if (ecommerceResult) {
    const [ecommerceResponse] = ecommerceResult;
    for (const row of ecommerceResponse.rows || []) {
      const dateRaw = row.dimensionValues?.[0]?.value || "";
      if (!dateRaw) continue;
      const existing = byDate.get(dateRaw) || createEmptyGA4Row(dateRaw);
      const transactions = parseInt(row.metricValues?.[0]?.value || "0", 10);
      const revenue = parseFloat(row.metricValues?.[1]?.value || "0");
      const addToCarts = parseInt(row.metricValues?.[2]?.value || "0", 10);
      const checkouts = parseInt(row.metricValues?.[3]?.value || "0", 10);

      existing.transactions = transactions;
      existing.revenue = parseFloat(revenue.toFixed(2));
      existing.addToCarts = addToCarts;
      existing.checkouts = checkouts;
      byDate.set(dateRaw, existing);

      totals.transactions += transactions;
      totals.revenue += revenue;
      totals.addToCarts += addToCarts;
      totals.checkouts += checkouts;
    }
  }

  totals.revenue = parseFloat(totals.revenue.toFixed(2));

  const insights = [...byDate.values()].sort((a, b) => a.dateRaw.localeCompare(b.dateRaw));
  return { insights, totals };
}

// --- Product viewers (users who fired the ecommerce "view_item" event) ---
// Powers the "Produtos" funnel stage. We count USERS (not item impressions):
// `itemsViewed` is item-scoped and routinely exceeds the user/session base,
// which would invert the top of the funnel. `totalUsers` filtered by
// eventName=view_item is a strict subset of total users, so it nests cleanly
// under "Usuários". Isolated from getGA4DailyReport on purpose so a metric
// incompatibility can never break the whole overview — wrap in `.catch(() => null)`.
export async function getGA4ProductViewers(args: {
  propertyId?: string;
  datePreset?: string;
  startDate?: string;
  endDate?: string;
}): Promise<{ productViewers: number }> {
  const client = getClient();
  const propertyId = args.propertyId || getPropertyId();

  const range = args.startDate && args.endDate
    ? { startDate: args.startDate, endDate: args.endDate }
    : datePresetToRange(args.datePreset || "last_30d");

  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    metrics: [{ name: "totalUsers" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        stringFilter: { matchType: "EXACT", value: "view_item" },
      },
    },
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
  });

  const productViewers = parseInt(response.rows?.[0]?.metricValues?.[0]?.value || "0", 10);
  return { productViewers };
}

// --- Google Ads cost via GA4 ---

export async function getGA4GoogleAdsCost(args: {
  propertyId?: string;
  datePreset?: string;
  startDate?: string;
  endDate?: string;
}): Promise<GoogleAdsReport | null> {
  const client = getClient();
  const propertyId = args.propertyId || getPropertyId();

  const range = args.startDate && args.endDate
    ? { startDate: args.startDate, endDate: args.endDate }
    : datePresetToRange(args.datePreset || "last_30d");

  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    dimensions: [{ name: "date" }],
    metrics: [
      { name: "advertiserAdCost" },
      { name: "advertiserAdClicks" },
      { name: "advertiserAdImpressions" },
    ],
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    orderBys: [{ dimension: { dimensionName: "date", orderType: "NUMERIC" }, desc: false }],
  });

  const rows = response.rows || [];
  const daily: GoogleAdsDailyRow[] = [];
  const totals = { cost: 0, clicks: 0, impressions: 0, cpc: 0, ctr: 0 };

  for (const row of rows) {
    const dateRaw = row.dimensionValues?.[0]?.value || "";
    const cost = parseFloat(row.metricValues?.[0]?.value || "0");
    const clicks = parseInt(row.metricValues?.[1]?.value || "0", 10);
    const impressions = parseInt(row.metricValues?.[2]?.value || "0", 10);

    totals.cost += cost;
    totals.clicks += clicks;
    totals.impressions += impressions;

    daily.push({
      date: formatDate(dateRaw),
      dateRaw,
      cost: parseFloat(cost.toFixed(2)),
      clicks,
      impressions,
    });
  }

  // If total cost is 0, Google Ads is not linked to GA4
  if (totals.cost === 0 && totals.clicks === 0) {
    return null;
  }

  totals.cpc = totals.clicks > 0 ? parseFloat((totals.cost / totals.clicks).toFixed(2)) : 0;
  totals.ctr = totals.impressions > 0 ? parseFloat(((totals.clicks / totals.impressions) * 100).toFixed(2)) : 0;
  totals.cost = parseFloat(totals.cost.toFixed(2));

  return { daily, totals };
}

// --- Generic report function ---

export interface GA4GenericRow {
  dimensions: Record<string, string>;
  metrics: Record<string, number>;
}

export interface GA4GenericReport {
  rows: GA4GenericRow[];
}

export async function getGA4Report(args: {
  propertyId?: string;
  datePreset?: string;
  startDate?: string;
  endDate?: string;
  dimensions: string[];
  metrics: string[];
  limit?: number;
  orderBy?: { metric: string; desc: boolean };
}): Promise<GA4GenericReport> {
  const client = getClient();
  const propertyId = args.propertyId || getPropertyId();

  const range = args.startDate && args.endDate
    ? { startDate: args.startDate, endDate: args.endDate }
    : datePresetToRange(args.datePreset || "last_30d");

  const orderBys = args.orderBy
    ? [{ metric: { metricName: args.orderBy.metric }, desc: args.orderBy.desc }]
    : undefined;

  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    dimensions: args.dimensions.map((name) => ({ name })),
    metrics: args.metrics.map((name) => ({ name })),
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    limit: args.limit || 50,
    orderBys,
  });

  const rows: GA4GenericRow[] = (response.rows || []).map((row) => {
    const dimensions: Record<string, string> = {};
    args.dimensions.forEach((dim, i) => {
      dimensions[dim] = row.dimensionValues?.[i]?.value || "";
    });

    const metrics: Record<string, number> = {};
    args.metrics.forEach((met, i) => {
      metrics[met] = parseFloat(row.metricValues?.[i]?.value || "0");
    });

    return { dimensions, metrics };
  });

  return { rows };
}
