import { BetaAnalyticsDataClient } from "@google-analytics/data";

// --- Client singleton ---

let _client: BetaAnalyticsDataClient | null = null;

function getClient(): BetaAnalyticsDataClient {
  if (_client) return _client;

  const credentialsJson = process.env.GA4_CREDENTIALS_JSON;
  if (credentialsJson) {
    const credentials = JSON.parse(credentialsJson);
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
  date: string; // MM-DD format (to match Meta trend data)
  dateRaw: string; // YYYYMMDD
  sessions: number;
  users: number;
  newUsers: number;
  transactions: number;
  revenue: number;
  pageViews: number;
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
  };
}

// --- Date helpers ---

function datePresetToRange(preset: string): { startDate: string; endDate: string } {
  switch (preset) {
    case "today":
      return { startDate: "today", endDate: "today" };
    case "yesterday":
      return { startDate: "yesterday", endDate: "yesterday" };
    case "last_7d":
      return { startDate: "7daysAgo", endDate: "yesterday" };
    case "last_14d":
      return { startDate: "14daysAgo", endDate: "yesterday" };
    case "last_30d":
      return { startDate: "30daysAgo", endDate: "yesterday" };
    case "last_90d":
      return { startDate: "90daysAgo", endDate: "yesterday" };
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
      return { startDate: "30daysAgo", endDate: "yesterday" };
  }
}

// Convert YYYYMMDD to MM-DD
function formatDate(yyyymmdd: string): string {
  const month = yyyymmdd.slice(4, 6);
  const day = yyyymmdd.slice(6, 8);
  return `${month}-${day}`;
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

  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    dimensions: [{ name: "date" }],
    metrics: [
      { name: "sessions" },
      { name: "totalUsers" },
      { name: "newUsers" },
      { name: "transactions" },
      { name: "purchaseRevenue" },
      { name: "screenPageViews" },
    ],
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    orderBys: [{ dimension: { dimensionName: "date", orderType: "NUMERIC" }, desc: false }],
  });

  const rows = response.rows || [];
  const insights: GA4DailyRow[] = [];
  const totals = {
    sessions: 0,
    users: 0,
    newUsers: 0,
    transactions: 0,
    revenue: 0,
    pageViews: 0,
  };

  for (const row of rows) {
    const dateRaw = row.dimensionValues?.[0]?.value || "";
    const sessions = parseInt(row.metricValues?.[0]?.value || "0", 10);
    const users = parseInt(row.metricValues?.[1]?.value || "0", 10);
    const newUsers = parseInt(row.metricValues?.[2]?.value || "0", 10);
    const transactions = parseInt(row.metricValues?.[3]?.value || "0", 10);
    const revenue = parseFloat(row.metricValues?.[4]?.value || "0");
    const pageViews = parseInt(row.metricValues?.[5]?.value || "0", 10);

    totals.sessions += sessions;
    totals.users += users;
    totals.newUsers += newUsers;
    totals.transactions += transactions;
    totals.revenue += revenue;
    totals.pageViews += pageViews;

    insights.push({
      date: formatDate(dateRaw),
      dateRaw,
      sessions,
      users,
      newUsers,
      transactions,
      revenue: parseFloat(revenue.toFixed(2)),
      pageViews,
    });
  }

  return { insights, totals };
}
