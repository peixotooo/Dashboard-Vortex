import type { CampaignWithMetrics, DatePreset } from "@/lib/types";

// --- Config ---

// TikTok Marketing API version. Env-configurable like GOOGLE_ADS_API_VERSION so a
// future bump (TikTok ships ~yearly) needs no code change. v1.3 is current.
const API_VERSION = process.env.TIKTOK_API_VERSION?.trim() || "v1.3";
const BASE_URL = `https://business-api.tiktok.com/open_api/${API_VERSION}`;

function getAppId(): string {
  const id = process.env.TIKTOK_APP_ID;
  if (!id) throw new Error("TIKTOK_APP_ID not configured");
  return id;
}

function getAppSecret(): string {
  const secret = process.env.TIKTOK_APP_SECRET;
  if (!secret) throw new Error("TIKTOK_APP_SECRET not configured");
  return secret;
}

// --- Request wrapper ---

interface TikTokEnvelope<T = unknown> {
  code: number;
  message: string;
  request_id?: string;
  data: T;
}

// TikTok rate-limit / transient codes worth a short retry. The API returns errors
// as HTTP 200 with a non-zero `code` in the envelope (NOT via res.ok), so we key
// the backoff off the envelope code, not the HTTP status.
const RETRYABLE_CODES = new Set([40100, 40133, 50000, 50002]);

function parseTikTokError(code: number, message: string): string {
  if (code === 40105 || code === 40002) {
    return (
      "TikTok auth invalida (code " +
      code +
      "): o Access-Token expirou ou foi revogado no Business Center. " +
      "Reconecte em /api/tiktok/auth. Detalhe: " +
      message
    );
  }
  if (code === 40100 || code === 50002) {
    return `TikTok rate limit (code ${code}): muitas requisicoes. Tente novamente em instantes. Detalhe: ${message}`;
  }
  if (code === 40001 || code === 40002) {
    return `TikTok permissao negada (code ${code}): o app pode nao ter o scope aprovado (ex.: Reporting). Detalhe: ${message}`;
  }
  return `TikTok API error (code ${code}): ${message}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Calls a TikTok Marketing API endpoint. GET params that are objects/arrays
 * (dimensions, metrics, filtering, fields) MUST be JSON-encoded strings in the
 * query — that is TikTok's convention. The access token goes in the `Access-Token`
 * header (exact casing), never as a query param.
 */
async function tiktokRequest<T = unknown>(
  path: string,
  params: Record<string, unknown>,
  accessToken: string,
  method: "GET" | "POST" = "GET"
): Promise<T> {
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    let url = `${BASE_URL}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        "Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    };

    if (method === "GET") {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null) continue;
        qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
      }
      const query = qs.toString();
      if (query) url += `?${query}`;
    } else {
      options.body = JSON.stringify(params);
    }

    const res = await fetch(url, options);
    const json = (await res.json().catch(() => null)) as TikTokEnvelope<T> | null;

    if (!json) {
      lastErr = new Error(`TikTok API: resposta nao-JSON (HTTP ${res.status})`);
      break;
    }

    if (json.code === 0) {
      return json.data;
    }

    if (RETRYABLE_CODES.has(json.code) && attempt < 2) {
      lastErr = new Error(parseTikTokError(json.code, json.message));
      await sleep(1200 * (attempt + 1)); // 1.2s, 2.4s backoff
      continue;
    }

    throw new Error(parseTikTokError(json.code, json.message));
  }

  throw lastErr || new Error("TikTok API: falha apos retentativas");
}

// --- Date Preset to range ---

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolves a DatePreset into TikTok's start_date / end_date (YYYY-MM-DD, inclusive).
 * TikTok's report endpoint has no relative-range keyword, so we compute concrete
 * dates like the Google client does for last_90d.
 */
function datePresetToRange(preset: DatePreset): { start_date: string; end_date: string } {
  const today = new Date();
  const start = new Date(today);

  switch (preset) {
    case "today":
      break;
    case "yesterday":
      start.setDate(start.getDate() - 1);
      today.setDate(today.getDate() - 1);
      break;
    case "last_7d":
      start.setDate(start.getDate() - 6);
      break;
    case "last_14d":
      start.setDate(start.getDate() - 13);
      break;
    case "last_30d":
      start.setDate(start.getDate() - 29);
      break;
    case "last_90d":
      start.setDate(start.getDate() - 89);
      break;
    case "this_month":
      start.setDate(1);
      break;
    case "last_month": {
      start.setMonth(start.getMonth() - 1, 1);
      const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start_date: fmt(start), end_date: fmt(endOfLastMonth) };
    }
    default:
      start.setDate(start.getDate() - 29);
  }

  return { start_date: fmt(start), end_date: fmt(today) };
}

// TikTok operation_status -> the platform-neutral status the UI expects.
function mapStatus(operationStatus?: string): string {
  switch (operationStatus) {
    case "ENABLE":
      return "ACTIVE";
    case "DISABLE":
      return "PAUSED";
    case "DELETE":
      return "DELETED";
    default:
      return operationStatus || "UNKNOWN";
  }
}

// TikTok's `secondary_status` takes a SINGLE enum, not a list. The Meta/Google
// routes pass ["ACTIVE","PAUSED"] meaning "everything except deleted" → map that to
// STATUS_NOT_DELETE. If a caller explicitly asks for deleted too, omit the filter.
function statusesToSecondaryStatus(statuses: string[]): string | undefined {
  const wantsDeleted = statuses.some((s) => {
    const u = s.toUpperCase();
    return u === "DELETED" || u === "REMOVED";
  });
  return wantsDeleted ? undefined : "STATUS_NOT_DELETE";
}

// --- Types for the raw TikTok responses ---

interface TikTokCampaign {
  campaign_id?: string;
  campaign_name?: string;
  operation_status?: string;
  objective_type?: string;
  budget?: number;
  budget_mode?: string;
}

interface TikTokReportRow {
  dimensions?: { campaign_id?: string };
  metrics?: Record<string, string | number | undefined>;
}

function num(val: string | number | undefined): number {
  const n = typeof val === "string" ? parseFloat(val) : val;
  return Number.isFinite(n as number) ? (n as number) : 0;
}

function normalizeCampaign(
  meta: TikTokCampaign,
  metrics: Record<string, string | number | undefined> | undefined
): CampaignWithMetrics {
  const spend = num(metrics?.spend);
  const impressions = Math.round(num(metrics?.impressions));
  const clicks = Math.round(num(metrics?.clicks));
  const reach = Math.round(num(metrics?.reach));
  // TikTok returns ctr/cpc/cpm already computed (ctr as a percent value). Fall back
  // to deriving them if the report omits them so the column is never blank.
  const ctr = metrics?.ctr !== undefined ? num(metrics.ctr) : impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cpc = metrics?.cpc !== undefined ? num(metrics.cpc) : clicks > 0 ? spend / clicks : 0;
  const cpm = metrics?.cpm !== undefined ? num(metrics.cpm) : impressions > 0 ? (spend / impressions) * 1000 : 0;
  const roas = num(metrics?.complete_payment_roas);
  const purchases = Math.round(num(metrics?.complete_payment));
  // TikTok exposes ROAS directly; revenue = spend * roas (consistent with Meta's
  // purchase-action ROAS reading).
  const revenue = roas > 0 ? spend * roas : 0;
  const budget = num(meta.budget);

  return {
    id: meta.campaign_id || "",
    name: meta.campaign_name || "",
    status: mapStatus(meta.operation_status),
    objective: meta.objective_type || "",
    // TikTok budget is in account currency (no micros). Store in cents like Meta.
    daily_budget: budget > 0 ? String(Math.round(budget * 100)) : undefined,
    impressions,
    clicks,
    spend: parseFloat(spend.toFixed(2)),
    reach,
    ctr: parseFloat(ctr.toFixed(2)),
    cpc: parseFloat(cpc.toFixed(2)),
    cpm: parseFloat(cpm.toFixed(2)),
    revenue: parseFloat(revenue.toFixed(2)),
    purchases,
    roas: parseFloat(roas.toFixed(2)),
  };
}

// --- Public Functions ---

const REPORT_METRICS = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "reach",
  "conversion",
  "complete_payment",
  "complete_payment_roas",
];

const CAMPAIGN_FIELDS = [
  "campaign_id",
  "campaign_name",
  "operation_status",
  "objective_type",
  "budget",
  "budget_mode",
];

/**
 * Fetches campaigns for a TikTok advertiser and merges them with BASIC report
 * metrics (spend / ROAS / impressions / clicks ...) into the shared
 * CampaignWithMetrics shape used by the Meta and Google tabs.
 */
export async function getTikTokAdsCampaigns(args: {
  accessToken: string;
  advertiserId: string;
  datePreset?: DatePreset;
  statuses?: string[];
}): Promise<{ campaigns: CampaignWithMetrics[] }> {
  const { accessToken, advertiserId } = args;
  const { start_date, end_date } = datePresetToRange(args.datePreset || "last_30d");
  const secondaryStatus = statusesToSecondaryStatus(args.statuses || ["ACTIVE", "PAUSED"]);

  // 1) Campaign metadata (name, status, objective, budget).
  const campaignData = await tiktokRequest<{ list?: TikTokCampaign[] }>(
    "/campaign/get/",
    {
      advertiser_id: advertiserId,
      fields: CAMPAIGN_FIELDS,
      page: 1,
      page_size: 1000,
      ...(secondaryStatus ? { filtering: { secondary_status: secondaryStatus } } : {}),
    },
    accessToken
  );
  const campaigns = campaignData.list || [];

  // 2) Performance report keyed by campaign_id for the same window.
  const reportData = await tiktokRequest<{ list?: TikTokReportRow[] }>(
    "/report/integrated/get/",
    {
      advertiser_id: advertiserId,
      report_type: "BASIC",
      data_level: "AUCTION_CAMPAIGN",
      dimensions: ["campaign_id"],
      metrics: REPORT_METRICS,
      start_date,
      end_date,
      page: 1,
      page_size: 1000,
    },
    accessToken
  );

  const metricsByCampaign = new Map<string, Record<string, string | number | undefined>>();
  for (const row of reportData.list || []) {
    const id = row.dimensions?.campaign_id;
    if (id) metricsByCampaign.set(id, row.metrics || {});
  }

  const normalized = campaigns
    .map((c) => normalizeCampaign(c, c.campaign_id ? metricsByCampaign.get(c.campaign_id) : undefined))
    .sort((a, b) => b.spend - a.spend);

  return { campaigns: normalized };
}

// --- Account Discovery ---

export interface TikTokAdvertiser {
  id: string;
  name: string;
  currency?: string;
  timezone?: string;
  status?: string;
}

interface AdvertiserRow {
  advertiser_id?: string;
  advertiser_name?: string;
  currency?: string;
  timezone?: string;
  status?: string;
}

/**
 * Lists the advertiser accounts the connected token is authorized for, enriched
 * with names/currency. The id+secret pair authorizes the lookup; the token scopes
 * it to the authorized advertisers. Used to discover/label advertiser_id.
 */
export async function getTikTokAdvertisers(
  accessToken: string
): Promise<TikTokAdvertiser[]> {
  const data = await tiktokRequest<{ list?: AdvertiserRow[] }>(
    "/oauth2/advertiser/get/",
    {
      app_id: getAppId(),
      secret: getAppSecret(),
    },
    accessToken
  );

  return (data.list || []).map((a) => ({
    id: a.advertiser_id || "",
    name: a.advertiser_name || "(sem nome)",
    currency: a.currency,
    timezone: a.timezone,
    status: a.status,
  }));
}
