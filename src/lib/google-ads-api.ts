import type { CampaignWithMetrics, DatePreset } from "@/lib/types";

// --- Config ---

// Google Ads API version. Configurable via env so it can be bumped without a code
// change when Google sunsets old versions (~quarterly). v19 sunset 2026-02-11 and
// v20 sunset 2026-06-10 — a sunset version 404s every call. Default to a supported one.
const API_VERSION = process.env.GOOGLE_ADS_API_VERSION?.trim() || "v24";
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
    if (err.includes("invalid_grant")) {
      throw new Error(
        "OAuth invalid_grant ao renovar o token do Google Ads: o GOOGLE_ADS_REFRESH_TOKEN expirou ou foi revogado. " +
          "Causa mais comum: a tela de consentimento OAuth ficou em modo 'Testing' (refresh token expira em 7 dias). " +
          "Publique o app (status 'In production') e gere um novo com: npx tsx scripts/google-ads-auth.ts"
      );
    }
    throw new Error(`Falha ao renovar o OAuth token do Google: ${err}`);
  }

  const data = await res.json();
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new Error(`Resposta OAuth do Google sem access_token: ${JSON.stringify(data)}`);
  }
  const expiresInSec = Number(data.expires_in);
  const lifetimeMs = Number.isFinite(expiresInSec) ? (expiresInSec - 60) * 1000 : 0;
  _cachedToken = {
    token: data.access_token,
    // refresh 60s early; falls back to immediate re-refresh if expires_in is missing (never NaN).
    expiresAt: Date.now() + lifetimeMs,
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

/**
 * Turn a raw Google Ads REST error body into a readable, actionable message.
 * Detects the classic DEVELOPER_TOKEN_NOT_APPROVED (test-token) trap, permission
 * issues, bad customer IDs, and version sunsets (404).
 */
function parseGoogleAdsError(status: number, body: string): string {
  try {
    const json = JSON.parse(body);
    const errObj = Array.isArray(json) ? json[0]?.error : json?.error;
    const gaErr = errObj?.details?.[0]?.errors?.[0];
    const codeKey = gaErr?.errorCode
      ? (Object.values(gaErr.errorCode)[0] as string)
      : undefined;
    const message: string | undefined = gaErr?.message || errObj?.message;

    if (codeKey === "DEVELOPER_TOKEN_NOT_APPROVED") {
      return (
        "DEVELOPER_TOKEN_NOT_APPROVED: o developer token so funciona em contas de TESTE. " +
        "Aplique para 'Basic Access' no API Center da sua conta gerenciadora (MCC) do Google Ads para acessar contas reais."
      );
    }
    if (codeKey === "USER_PERMISSION_DENIED") {
      return (
        "USER_PERMISSION_DENIED: o usuario do OAuth nao tem acesso a esta conta, ou falta o login-customer-id (MCC). " +
        "Defina GOOGLE_ADS_LOGIN_CUSTOMER_ID com o ID da conta gerenciadora."
      );
    }
    if (codeKey === "CUSTOMER_NOT_FOUND") {
      return "CUSTOMER_NOT_FOUND: verifique GOOGLE_ADS_CUSTOMER_ID (somente digitos, sem hifens).";
    }
    if (codeKey || message) {
      return `Google Ads (${codeKey || status}): ${message}`;
    }
  } catch {
    // body was not JSON — fall through to generic handling
  }
  if (status === 404) {
    return (
      `Google Ads API 404: endpoint nao encontrado. A versao '${API_VERSION}' pode ter sido ` +
      "descontinuada (sunset). Ajuste GOOGLE_ADS_API_VERSION para uma versao suportada (ex.: v24). " +
      `Detalhe: ${body.slice(0, 200)}`
    );
  }
  return `Google Ads API error (${status}): ${body.slice(0, 500)}`;
}

async function executeGaql<T = GaqlRow>(query: string, customerId?: string): Promise<T[]> {
  const cid = (customerId || getCustomerId()).replace(/-/g, "");
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
    throw new Error(parseGoogleAdsError(res.status, errBody));
  }

  const data = await res.json();

  // searchStream returns an array of batches, each with a "results" array
  const rows: T[] = [];
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
      past.setDate(past.getDate() - 89); // inclusive BETWEEN → 90 days total
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
  const raw = typeof val === "string" ? parseFloat(val) : val;
  const n = Number.isFinite(raw as number) ? (raw as number) : 0; // guard "" / non-numeric → 0, not NaN
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
  // Use the standard `conversions` / `conversions_value` definition consistently.
  // Falling back to all_conversions* silently changes the metric definition for
  // campaigns with zero standard conversions and skews ROAS.
  const revenue = row.metrics?.conversionsValue ?? 0;
  const purchases = row.metrics?.conversions ?? 0;
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
    daily_budget: budget > 0 ? String(Math.round(budget * 100)) : undefined, // store in cents like Meta
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

// --- Account Discovery ---

export interface GoogleAdsAccount {
  id: string;
  name: string;
  manager: boolean;
  testAccount: boolean;
  currencyCode?: string;
  timeZone?: string;
}

interface CustomerRow {
  customer?: {
    id?: string;
    descriptiveName?: string;
    manager?: boolean;
    testAccount?: boolean;
    currencyCode?: string;
    timeZone?: string;
  };
}

/**
 * Returns the customer IDs (digits only, no hyphens) directly accessible to the
 * authenticated OAuth user. Use this to discover GOOGLE_ADS_CUSTOMER_ID.
 * Note: listAccessibleCustomers takes no customer ID and ignores login-customer-id.
 */
export async function listAccessibleCustomers(): Promise<string[]> {
  const token = await getAccessToken();
  const devToken = getDeveloperToken();

  const res = await fetch(`${BASE_URL}/customers:listAccessibleCustomers`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "developer-token": devToken,
    },
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(parseGoogleAdsError(res.status, errBody));
  }

  const data = await res.json();
  const names: string[] = data.resourceNames || [];
  return names.map((rn) => rn.split("/")[1]).filter(Boolean);
}

/**
 * Lists accessible accounts with human-readable details (name, manager flag,
 * currency, timezone, test-account flag). Best-effort: an account whose details
 * can't be fetched still appears with its ID so it can be used.
 */
export async function listAccessibleCustomersDetailed(): Promise<GoogleAdsAccount[]> {
  const ids = await listAccessibleCustomers();
  const accounts: GoogleAdsAccount[] = [];
  let lastError: unknown = null;
  let anyDetailed = false;

  for (const id of ids) {
    try {
      const rows = await executeGaql<CustomerRow>(
        "SELECT customer.id, customer.descriptive_name, customer.manager, " +
          "customer.test_account, customer.currency_code, customer.time_zone FROM customer",
        id
      );
      const c = rows[0]?.customer;
      accounts.push({
        id,
        name: c?.descriptiveName || "(sem nome)",
        manager: !!c?.manager,
        testAccount: !!c?.testAccount,
        currencyCode: c?.currencyCode,
        timeZone: c?.timeZone,
      });
      anyDetailed = true;
    } catch (err) {
      lastError = err;
      accounts.push({ id, name: "(detalhes indisponiveis)", manager: false, testAccount: false });
    }
  }

  // If the IDs listed fine but EVERY detail query failed, the cause is systemic
  // (e.g. DEVELOPER_TOKEN_NOT_APPROVED) — surface it so the route shows the real
  // reason instead of returning a list of blank rows with HTTP 200.
  if (ids.length > 0 && !anyDetailed && lastError) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return accounts;
}

// --- Write operations (mutate) ---
//
// These change live campaigns and can affect real spend. Callers (CLI/UI) are
// responsible for confirming intent before invoking them.

async function mutateGoogleAds(
  resource: string,
  operations: unknown[],
  customerId?: string
): Promise<{ results?: Array<{ resourceName?: string }> }> {
  const cid = (customerId || getCustomerId()).replace(/-/g, "");
  const token = await getAccessToken();
  const devToken = getDeveloperToken();
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": devToken,
    "Content-Type": "application/json",
  };
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;

  const res = await fetch(`${BASE_URL}/customers/${cid}/${resource}:mutate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ operations }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(parseGoogleAdsError(res.status, errBody));
  }
  return res.json();
}

export type CampaignStatus = "ENABLED" | "PAUSED";

export interface CampaignBasicInfo {
  id: string;
  name: string;
  status: string; // normalized: ACTIVE / PAUSED / DELETED
}

/**
 * Resolve a campaign by ID WITHOUT a segments.date join, so idle/paused
 * campaigns (which have zero metrics in any date window and are dropped from
 * segmented reports) are still found. Returns null if the ID doesn't exist in
 * the account. Used to give the write CLI a reliable preview before mutating.
 */
export async function getCampaignBasicInfo(
  campaignId: string,
  customerId?: string
): Promise<CampaignBasicInfo | null> {
  if (!/^\d+$/.test(campaignId)) throw new Error("campaignId invalido (apenas digitos).");
  const rows = await executeGaql<{ campaign?: { id?: string; name?: string; status?: string } }>(
    `SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.id = ${campaignId}`,
    customerId
  );
  const c = rows[0]?.campaign;
  if (!c) return null;
  return { id: c.id || campaignId, name: c.name || "", status: mapStatus(c.status) };
}

/** Pause or enable a campaign. Returns the mutated resource name. */
export async function setCampaignStatus(
  campaignId: string,
  status: CampaignStatus,
  customerId?: string
): Promise<string> {
  if (!/^\d+$/.test(campaignId)) throw new Error("campaignId invalido (apenas digitos).");
  const cid = (customerId || getCustomerId()).replace(/-/g, "");
  const result = await mutateGoogleAds(
    "campaigns",
    [
      {
        updateMask: "status",
        update: {
          resourceName: `customers/${cid}/campaigns/${campaignId}`,
          status,
        },
      },
    ],
    customerId
  );
  return result?.results?.[0]?.resourceName || "";
}

export interface CampaignBudgetInfo {
  campaignName: string;
  campaignStatus: string;
  budgetResourceName: string;
  currentDailyAmount: number; // account currency units (e.g. BRL)
  explicitlyShared: boolean;
  referenceCount: number;
}

/** Look up a campaign's budget resource (and whether it is shared across campaigns). */
export async function getCampaignBudgetInfo(
  campaignId: string,
  customerId?: string
): Promise<CampaignBudgetInfo | null> {
  if (!/^\d+$/.test(campaignId)) throw new Error("campaignId invalido (apenas digitos).");
  const rows = await executeGaql<{
    campaign?: { name?: string; status?: string };
    campaignBudget?: {
      resourceName?: string;
      amountMicros?: string;
      explicitlyShared?: boolean;
      referenceCount?: number;
    };
  }>(
    "SELECT campaign.name, campaign.status, campaign_budget.resource_name, " +
      "campaign_budget.amount_micros, campaign_budget.explicitly_shared, " +
      `campaign_budget.reference_count FROM campaign WHERE campaign.id = ${campaignId}`,
    customerId
  );
  const row = rows[0];
  if (!row?.campaignBudget?.resourceName) return null;
  return {
    campaignName: row.campaign?.name || "",
    campaignStatus: mapStatus(row.campaign?.status),
    budgetResourceName: row.campaignBudget.resourceName,
    currentDailyAmount: micros(row.campaignBudget.amountMicros),
    explicitlyShared: !!row.campaignBudget.explicitlyShared,
    referenceCount: Number(row.campaignBudget.referenceCount ?? 1),
  };
}

/** Set a campaign budget's daily amount (in account currency units, e.g. BRL). */
export async function setCampaignDailyBudget(
  budgetResourceName: string,
  dailyAmount: number,
  customerId?: string
): Promise<string> {
  if (!(dailyAmount > 0)) throw new Error("O orcamento diario precisa ser maior que zero.");
  const amountMicros = Math.round(dailyAmount * 1_000_000).toString();
  const result = await mutateGoogleAds(
    "campaignBudgets",
    [
      {
        // Google Ads REST updateMask uses snake_case field paths; camelCase
        // ("amountMicros") silently no-ops for multi-word fields. ("status" is
        // safe either way because it's a single word.) The body field below
        // stays camelCase — only the mask is snake_case.
        updateMask: "amount_micros",
        update: { resourceName: budgetResourceName, amountMicros },
      },
    ],
    customerId
  );
  return result?.results?.[0]?.resourceName || "";
}

// --- Conversion goals (what the account optimizes/bids toward) ---

export interface ConversionGoal {
  resourceName: string;
  category: string; // PURCHASE, CONTACT, ADD_TO_CART, ...
  origin: string; // WEBSITE, APP, ...
  biddable: boolean; // true = counted in "Conversions" and used for bidding/optimization
}

/** List the account-default conversion goals (category/origin → biddable). */
export async function listConversionGoals(customerId?: string): Promise<ConversionGoal[]> {
  const rows = await executeGaql<{
    customerConversionGoal?: { resourceName?: string; category?: string; origin?: string; biddable?: boolean };
  }>(
    "SELECT customer_conversion_goal.resource_name, customer_conversion_goal.category, " +
      "customer_conversion_goal.origin, customer_conversion_goal.biddable FROM customer_conversion_goal",
    customerId
  );
  return rows
    .map((r) => r.customerConversionGoal)
    .filter((g): g is NonNullable<typeof g> => !!g?.resourceName)
    .map((g) => ({
      resourceName: g.resourceName as string,
      category: g.category || "",
      origin: g.origin || "",
      biddable: !!g.biddable,
    }));
}

/**
 * Set whether an account-default conversion goal is biddable (used for
 * optimization/bidding). Takes the exact resourceName from listConversionGoals.
 */
export async function setConversionGoalBiddable(
  resourceName: string,
  biddable: boolean,
  customerId?: string
): Promise<string> {
  const result = await mutateGoogleAds(
    "customerConversionGoals",
    [
      {
        updateMask: "biddable", // single word — case-insensitive either way
        update: { resourceName, biddable },
      },
    ],
    customerId
  );
  return result?.results?.[0]?.resourceName || "";
}
