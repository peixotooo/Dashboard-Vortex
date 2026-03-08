import type { CampaignWithMetrics, DatePreset } from "@/lib/types";

// --- Config ---

const API_VERSION = "v19";
const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`;

function getCustomerId(): string {
  const id = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!id) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");
  return id.replace(/-/g, "");
}

function getDeveloperToken(): string {
  const token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!token) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN not configured");
  return token;
}

// --- OAuth2 Token Management ---

let _cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt) {
    return _cachedToken.token;
  }

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Google Ads OAuth credentials not configured (GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN)"
    );
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to refresh Google OAuth token: ${err}`);
  }

  const data = await res.json();
  _cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000, // refresh 60s early
  };

  return _cachedToken.token;
}

// --- GAQL Query Execution ---

interface GaqlRow {
  campaign?: {
    id?: string;
    name?: string;
    status?: string;
    biddingStrategyType?: string;
    resourceName?: string;
  };
  campaignBudget?: {
    amountMicros?: string;
  };
  metrics?: {
    impressions?: string;
    clicks?: string;
    costMicros?: string;
    conversions?: number;
    conversionsValue?: number;
    ctr?: number;
    averageCpc?: number;
    allConversions?: number;
    allConversionsValue?: number;
  };
}

async function executeGaql(query: string, customerId?: string): Promise<GaqlRow[]> {
  const cid = customerId || getCustomerId();
  const token = await getAccessToken();
  const devToken = getDeveloperToken();
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": devToken,
    "Content-Type": "application/json",
  };

  if (loginCustomerId) {
    headers["login-customer-id"] = loginCustomerId;
  }

  const res = await fetch(
    `${BASE_URL}/customers/${cid}/googleAds:searchStream`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ query }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Google Ads API error (${res.status}): ${errBody}`);
  }

  const data = await res.json();

  // searchStream returns an array of batches, each with a "results" array
  const rows: GaqlRow[] = [];
  if (Array.isArray(data)) {
    for (const batch of data) {
      if (batch.results) {
        rows.push(...batch.results);
      }
    }
  }

  return rows;
}

// --- Date Preset to GAQL ---

function datePresetToGaql(preset: DatePreset): string {
  switch (preset) {
    case "today":
      return "DURING TODAY";
    case "yesterday":
      return "DURING YESTERDAY";
    case "last_7d":
      return "DURING LAST_7_DAYS";
    case "last_14d":
      return "DURING LAST_14_DAYS";
    case "last_30d":
      return "DURING LAST_30_DAYS";
    case "last_90d": {
      const today = new Date();
      const past = new Date(today);
      past.setDate(past.getDate() - 90);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      return `BETWEEN '${fmt(past)}' AND '${fmt(today)}'`;
    }
    case "this_month":
      return "DURING THIS_MONTH";
    case "last_month":
      return "DURING LAST_MONTH";
    default:
      return "DURING LAST_30_DAYS";
  }
}

function statusToGaql(statuses: string[]): string {
  const mapped = statuses.map((s) => {
    switch (s.toUpperCase()) {
      case "ACTIVE":
        return "'ENABLED'";
      case "PAUSED":
        return "'PAUSED'";
      case "DELETED":
      case "REMOVED":
        return "'REMOVED'";
      default:
        return `'${s.toUpperCase()}'`;
    }
  });
  return mapped.join(", ");
}

// --- Normalize to CampaignWithMetrics ---

function micros(val?: string | number): number {
  const n = typeof val === "string" ? parseFloat(val) : val || 0;
  return n / 1_000_000;
}

function mapStatus(status?: string): string {
  switch (status) {
    case "ENABLED":
      return "ACTIVE";
    case "PAUSED":
      return "PAUSED";
    case "REMOVED":
      return "DELETED";
    default:
      return status || "UNKNOWN";
  }
}

function normalizeCampaign(row: GaqlRow): CampaignWithMetrics {
  const spend = micros(row.metrics?.costMicros);
  const revenue = row.metrics?.conversionsValue ?? row.metrics?.allConversionsValue ?? 0;
  const purchases = row.metrics?.conversions ?? row.metrics?.allConversions ?? 0;
  const impressions = parseInt(row.metrics?.impressions || "0", 10);
  const clicks = parseInt(row.metrics?.clicks || "0", 10);
  const ctr = (row.metrics?.ctr ?? 0) * 100; // API returns as decimal
  const cpc = micros(row.metrics?.averageCpc);
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
  const roas = spend > 0 ? revenue / spend : 0;
  const budget = micros(row.campaignBudget?.amountMicros);

  return {
    id: row.campaign?.id || "",
    name: row.campaign?.name || "",
    status: mapStatus(row.campaign?.status),
    objective: row.campaign?.biddingStrategyType || "",
    daily_budget: budget > 0 ? String(budget * 100) : undefined, // store in cents like Meta
    impressions,
    clicks,
    spend: parseFloat(spend.toFixed(2)),
    reach: 0, // Google Ads doesn't have reach in campaign metrics
    ctr: parseFloat(ctr.toFixed(2)),
    cpc: parseFloat(cpc.toFixed(2)),
    cpm: parseFloat(cpm.toFixed(2)),
    revenue: parseFloat(revenue.toFixed(2)),
    purchases: Math.round(purchases),
    roas: parseFloat(roas.toFixed(2)),
  };
}

// --- Public Functions ---

export async function getGoogleAdsCampaigns(args: {
  datePreset?: DatePreset;
  statuses?: string[];
  customerId?: string;
}): Promise<{ campaigns: CampaignWithMetrics[] }> {
  const dateClause = datePresetToGaql(args.datePreset || "last_30d");
  const statuses = args.statuses || ["ACTIVE", "PAUSED"];
  const statusClause = statusToGaql(statuses);

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.bidding_strategy_type,
      campaign_budget.amount_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.all_conversions,
      metrics.all_conversions_value,
      metrics.ctr,
      metrics.average_cpc
    FROM campaign
    WHERE segments.date ${dateClause}
      AND campaign.status IN (${statusClause})
    ORDER BY metrics.cost_micros DESC
  `;

  const rows = await executeGaql(query, args.customerId);
  const campaigns = rows.map(normalizeCampaign);

  return { campaigns };
}
