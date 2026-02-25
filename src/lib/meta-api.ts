const API_VERSION = process.env.META_API_VERSION || "v23.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

// Token can be passed explicitly or fallback to env var
let _contextToken: string | null = null;

export function setContextToken(token: string) {
  _contextToken = token;
}

function getToken(): string {
  if (_contextToken) return _contextToken;
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN not configured");
  return token;
}

async function graphRequest(
  path: string,
  params: Record<string, string> = {},
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: Record<string, unknown>
): Promise<unknown> {
  const token = getToken();
  const url = new URL(`${BASE_URL}${path}`);
  params.access_token = token;

  if (method === "GET") {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const options: RequestInit = { method };

  if (method === "POST" && body) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify({ ...body, access_token: token });
  } else if (method === "POST") {
    const formData = new URLSearchParams();
    formData.set("access_token", token);
    Object.entries(params).forEach(([k, v]) => {
      if (k !== "access_token") formData.set(k, v);
    });
    options.headers = { "Content-Type": "application/x-www-form-urlencoded" };
    options.body = formData.toString();
  } else if (method === "DELETE") {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url.toString(), options);
  const data = await res.json();

  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }

  return data;
}

// ============ Ad Accounts ============

export async function getAdAccounts(): Promise<unknown> {
  const data = await graphRequest("/me/adaccounts", {
    fields: "id,account_id,name,account_status,currency,timezone_name,business_name,amount_spent",
    limit: "50",
  });
  const result = data as { data?: unknown[] };
  return { accounts: result.data || [] };
}

// ============ Campaigns ============

export async function listCampaigns(args: {
  account_id?: string;
  limit?: number;
  status_filter?: string;
}): Promise<unknown> {
  // If no account_id, get first account
  let accountId = args.account_id;
  if (!accountId) {
    const accounts = (await getAdAccounts()) as { accounts: Array<{ id: string }> };
    if (accounts.accounts.length === 0) return { campaigns: [] };
    accountId = accounts.accounts[0].id;
  }
  if (!accountId.startsWith("act_")) accountId = `act_${accountId}`;

  const params: Record<string, string> = {
    fields: "id,name,status,objective,daily_budget,lifetime_budget,budget_remaining,created_time,updated_time,start_time,stop_time,special_ad_categories,bid_strategy",
    limit: String(args.limit || 25),
  };
  if (args.status_filter) {
    params.filtering = JSON.stringify([
      { field: "status", operator: "IN", value: [args.status_filter] },
    ]);
  }

  const data = await graphRequest(`/${accountId}/campaigns`, params);
  const result = data as { data?: unknown[] };
  return { campaigns: result.data || [] };
}

export async function createCampaign(args: Record<string, unknown>): Promise<unknown> {
  let accountId = (args.account_id as string) || "";
  if (!accountId) {
    const accounts = (await getAdAccounts()) as { accounts: Array<{ id: string }> };
    if (accounts.accounts.length === 0) throw new Error("No ad accounts found");
    accountId = accounts.accounts[0].id;
  }
  if (!accountId.startsWith("act_")) accountId = `act_${accountId}`;

  const params: Record<string, string> = {
    name: String(args.name || ""),
    objective: String(args.objective || "OUTCOME_TRAFFIC"),
    status: String(args.status || "PAUSED"),
    special_ad_categories: JSON.stringify(args.special_ad_categories || ["NONE"]),
  };
  if (args.daily_budget) params.daily_budget = String(args.daily_budget);
  if (args.lifetime_budget) params.lifetime_budget = String(args.lifetime_budget);
  if (args.bid_strategy) params.bid_strategy = String(args.bid_strategy);

  return graphRequest(`/${accountId}/campaigns`, params, "POST");
}

export async function pauseCampaign(args: { campaign_id: string }): Promise<unknown> {
  return graphRequest(`/${args.campaign_id}`, { status: "PAUSED" }, "POST");
}

export async function resumeCampaign(args: { campaign_id: string }): Promise<unknown> {
  return graphRequest(`/${args.campaign_id}`, { status: "ACTIVE" }, "POST");
}

export async function deleteCampaign(args: { campaign_id: string }): Promise<unknown> {
  return graphRequest(`/${args.campaign_id}`, { status: "DELETED" }, "POST");
}

export async function updateCampaign(args: Record<string, unknown>): Promise<unknown> {
  const campaignId = String(args.campaign_id);
  const params: Record<string, string> = {};
  if (args.name) params.name = String(args.name);
  if (args.status) params.status = String(args.status);
  if (args.daily_budget) params.daily_budget = String(args.daily_budget);
  return graphRequest(`/${campaignId}`, params, "POST");
}

// ============ Ad Sets ============

export async function listAdSets(args: {
  account_id?: string;
  campaign_id?: string;
  limit?: number;
}): Promise<unknown> {
  let path: string;
  if (args.campaign_id) {
    path = `/${args.campaign_id}/adsets`;
  } else {
    let accountId = args.account_id || "";
    if (!accountId) {
      const accounts = (await getAdAccounts()) as { accounts: Array<{ id: string }> };
      if (accounts.accounts.length === 0) return { ad_sets: [] };
      accountId = accounts.accounts[0].id;
    }
    if (!accountId.startsWith("act_")) accountId = `act_${accountId}`;
    path = `/${accountId}/adsets`;
  }

  const data = await graphRequest(path, {
    fields: "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,optimization_goal,billing_event,targeting,created_time",
    limit: String(args.limit || 25),
  });
  const result = data as { data?: unknown[] };
  return { ad_sets: result.data || [] };
}

export async function createAdSet(args: Record<string, unknown>): Promise<unknown> {
  const campaignId = String(args.campaign_id);
  // Get account from campaign
  const campaign = (await graphRequest(`/${campaignId}`, { fields: "account_id" })) as { account_id: string };
  const accountId = `act_${campaign.account_id}`;

  const params: Record<string, string> = {
    campaign_id: campaignId,
    name: String(args.name || ""),
    optimization_goal: String(args.optimization_goal || "LINK_CLICKS"),
    billing_event: String(args.billing_event || "IMPRESSIONS"),
    status: String(args.status || "PAUSED"),
  };
  if (args.daily_budget) params.daily_budget = String(args.daily_budget);
  if (args.targeting) params.targeting = JSON.stringify(args.targeting);

  return graphRequest(`/${accountId}/adsets`, params, "POST");
}

// ============ Ads ============

export async function listAds(args: {
  account_id?: string;
  campaign_id?: string;
  adset_id?: string;
  limit?: number;
}): Promise<unknown> {
  let path: string;
  if (args.adset_id) {
    path = `/${args.adset_id}/ads`;
  } else if (args.campaign_id) {
    path = `/${args.campaign_id}/ads`;
  } else {
    let accountId = args.account_id || "";
    if (!accountId) {
      const accounts = (await getAdAccounts()) as { accounts: Array<{ id: string }> };
      if (accounts.accounts.length === 0) return { ads: [] };
      accountId = accounts.accounts[0].id;
    }
    if (!accountId.startsWith("act_")) accountId = `act_${accountId}`;
    path = `/${accountId}/ads`;
  }

  const data = await graphRequest(path, {
    fields: "id,name,status,effective_status,campaign_id,adset_id,creative,created_time",
    limit: String(args.limit || 25),
  });
  const result = data as { data?: unknown[] };
  return { ads: result.data || [] };
}

export async function createAd(args: Record<string, unknown>): Promise<unknown> {
  const adsetId = String(args.adset_id);
  const adset = (await graphRequest(`/${adsetId}`, { fields: "account_id" })) as { account_id: string };
  const accountId = `act_${adset.account_id}`;

  const params: Record<string, string> = {
    name: String(args.name || ""),
    adset_id: adsetId,
    status: String(args.status || "PAUSED"),
  };
  if (args.creative) params.creative = JSON.stringify(args.creative);

  return graphRequest(`/${accountId}/ads`, params, "POST");
}

// ============ Insights ============

export async function getInsights(args: {
  object_id?: string;
  level?: string;
  date_preset?: string;
  time_range?: { since: string; until: string };
  fields?: string[];
  breakdowns?: string[];
  limit?: number;
  time_increment?: string;
}): Promise<unknown> {
  let objectId = args.object_id || "";
  if (!objectId) {
    const accounts = (await getAdAccounts()) as { accounts: Array<{ id: string }> };
    if (accounts.accounts.length === 0) return { insights: [] };
    objectId = accounts.accounts[0].id;
  }

  const params: Record<string, string> = {
    fields: (args.fields || ["impressions", "clicks", "spend", "reach", "frequency", "ctr", "cpc", "cpm"]).join(","),
    time_increment: args.time_increment || "1",
    limit: String(args.limit || 100),
  };

  if (args.time_range) {
    params.time_range = JSON.stringify(args.time_range);
  } else {
    params.date_preset = args.date_preset || "last_30d";
  }

  if (args.level) params.level = args.level;
  if (args.breakdowns) params.breakdowns = args.breakdowns.join(",");

  const data = await graphRequest(`/${objectId}/insights`, params);
  const result = data as { data?: unknown[] };
  return { insights: result.data || [] };
}

export async function comparePerformance(args: {
  object_ids: string[];
  level?: string;
  date_preset?: string;
  metrics?: string[];
}): Promise<unknown> {
  const results = await Promise.all(
    args.object_ids.map(async (id) => {
      const data = await getInsights({
        object_id: id,
        level: args.level,
        date_preset: args.date_preset,
        fields: args.metrics,
      });
      return { object_id: id, ...(data as Record<string, unknown>) };
    })
  );
  return { comparison_results: results };
}

// ============ Audiences ============

export async function listAudiences(args: { account_id?: string }): Promise<unknown> {
  let accountId = args.account_id || "";
  if (!accountId) {
    const accounts = (await getAdAccounts()) as { accounts: Array<{ id: string }> };
    if (accounts.accounts.length === 0) return { audiences: [] };
    accountId = accounts.accounts[0].id;
  }
  if (!accountId.startsWith("act_")) accountId = `act_${accountId}`;

  const data = await graphRequest(`/${accountId}/customaudiences`, {
    fields: "id,name,subtype,description,approximate_count,data_source,delivery_status,time_created,time_updated",
    limit: "50",
  });
  const result = data as { data?: unknown[] };
  return { audiences: result.data || [] };
}

export async function createCustomAudience(args: Record<string, unknown>): Promise<unknown> {
  let accountId = (args.account_id as string) || "";
  if (!accountId) {
    const accounts = (await getAdAccounts()) as { accounts: Array<{ id: string }> };
    if (accounts.accounts.length === 0) throw new Error("No ad accounts found");
    accountId = accounts.accounts[0].id;
  }
  if (!accountId.startsWith("act_")) accountId = `act_${accountId}`;

  const params: Record<string, string> = {
    name: String(args.name || ""),
    subtype: String(args.subtype || "CUSTOM"),
    description: String(args.description || ""),
    customer_file_source: String(args.customer_file_source || "USER_PROVIDED_ONLY"),
  };

  return graphRequest(`/${accountId}/customaudiences`, params, "POST");
}

export async function createLookalikeAudience(args: Record<string, unknown>): Promise<unknown> {
  let accountId = (args.account_id as string) || "";
  if (!accountId) {
    const accounts = (await getAdAccounts()) as { accounts: Array<{ id: string }> };
    if (accounts.accounts.length === 0) throw new Error("No ad accounts found");
    accountId = accounts.accounts[0].id;
  }
  if (!accountId.startsWith("act_")) accountId = `act_${accountId}`;

  const params: Record<string, string> = {
    name: String(args.name || ""),
    subtype: "LOOKALIKE",
    origin_audience_id: String(args.source_audience_id || ""),
    lookalike_spec: JSON.stringify({
      type: "similarity",
      country: String(args.country || "BR"),
      ratio: Number(args.ratio || 0.01),
    }),
  };

  return graphRequest(`/${accountId}/customaudiences`, params, "POST");
}

export async function estimateAudienceSize(args: { targeting: Record<string, unknown> }): Promise<unknown> {
  let accountId = "";
  const accounts = (await getAdAccounts()) as { accounts: Array<{ id: string }> };
  if (accounts.accounts.length === 0) throw new Error("No ad accounts found");
  accountId = accounts.accounts[0].id;
  if (!accountId.startsWith("act_")) accountId = `act_${accountId}`;

  return graphRequest(`/${accountId}/delivery_estimate`, {
    targeting_spec: JSON.stringify(args.targeting),
    optimization_goal: "REACH",
  });
}

// ============ Creatives ============

export async function uploadAdImage(formData: FormData): Promise<unknown> {
  let accountId = formData.get("account_id") as string || "";
  if (!accountId) {
    const accounts = (await getAdAccounts()) as { accounts: Array<{ id: string }> };
    if (accounts.accounts.length === 0) throw new Error("No ad accounts found");
    accountId = accounts.accounts[0].id;
  }
  if (!accountId.startsWith("act_")) accountId = `act_${accountId}`;

  const token = getToken();
  formData.set("access_token", token);
  formData.delete("account_id");

  const options: RequestInit = {
    method: "POST",
    body: formData,
  };

  const res = await fetch(`${BASE_URL}/${accountId}/adimages`, options);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

export async function createAdCreative(args: Record<string, unknown>): Promise<unknown> {
  let accountId = (args.account_id as string) || "";
  if (!accountId) {
    const accounts = (await getAdAccounts()) as { accounts: Array<{ id: string }> };
    if (accounts.accounts.length === 0) throw new Error("No ad accounts found");
    accountId = accounts.accounts[0].id;
  }
  if (!accountId.startsWith("act_")) accountId = `act_${accountId}`;

  const params: Record<string, string> = {
    name: String(args.name || ""),
  };

  const pageId = process.env.META_PAGE_ID || args.page_id || "";
  const linkUrl = process.env.META_DEFAULT_LINK || args.link || "https://example.com";

  if (pageId) {
    params.object_story_spec = JSON.stringify({
      page_id: String(pageId),
      link_data: {
        image_hash: String(args.image_hash || ""),
        link: String(linkUrl),
        message: String(args.body || ""),
        name: String(args.title || ""),
      }
    });
  } else {
    // Basic fallback if no page is associated
    params.title = String(args.title || "");
    params.body = String(args.body || "");
    params.image_hash = String(args.image_hash || "");
  }

  return graphRequest(`/${accountId}/adcreatives`, params, "POST");
}


export async function listCreatives(args: { account_id?: string }): Promise<unknown> {
  let accountId = args.account_id || "";
  if (!accountId) {
    const accounts = (await getAdAccounts()) as { accounts: Array<{ id: string }> };
    if (accounts.accounts.length === 0) return { creatives: [] };
    accountId = accounts.accounts[0].id;
  }
  if (!accountId.startsWith("act_")) accountId = `act_${accountId}`;

  const data = await graphRequest(`/${accountId}/adcreatives`, {
    fields: "id,name,title,body,image_url,video_id,call_to_action_type,status,thumbnail_url",
    limit: "50",
  });
  const result = data as { data?: unknown[] };
  return { creatives: result.data || [] };
}

export async function getCreativeDetails(args: { creative_id: string; account_id?: string }): Promise<unknown> {
  const creative = await graphRequest(`/${args.creative_id}`, {
    fields: "id,name,title,body,image_url,video_id,call_to_action_type,status,thumbnail_url,object_story_spec",
  });

  let ads: unknown[] = [];
  let adInsights: unknown[] = [];
  try {
    let accountId = args.account_id || "";
    if (!accountId) {
      const accounts = (await getAdAccounts()) as { accounts: Array<{ id: string }> };
      if (accounts.accounts.length > 0) accountId = accounts.accounts[0].id;
    }
    if (accountId && !accountId.startsWith("act_")) accountId = `act_${accountId}`;

    if (accountId) {
      const adsData = await graphRequest(`/${accountId}/ads`, {
        fields: "id,name,status,campaign_id,adset_id,campaign{name},adset{name}",
        filtering: JSON.stringify([
          { field: "creative.id", operator: "EQUAL", value: args.creative_id },
        ]),
        limit: "10",
      });
      ads = (adsData as { data?: unknown[] }).data || [];

      if (ads.length > 0) {
        const adIds = (ads as Array<{ id: string }>).map((a) => a.id);
        const insightsPromises = adIds.slice(0, 3).map((adId) =>
          graphRequest(`/${adId}/insights`, {
            fields: "impressions,clicks,spend,ctr,cpc,reach",
            date_preset: "last_30d",
          }).catch(() => ({ data: [] }))
        );
        const insightsResults = await Promise.all(insightsPromises);
        adInsights = insightsResults.flatMap((r) => (r as { data?: unknown[] }).data || []);
      }
    }
  } catch {
    // Non-critical
  }

  let totalImpressions = 0;
  let totalClicks = 0;
  let totalSpend = 0;
  let totalReach = 0;

  (adInsights as Array<Record<string, string>>).forEach((row) => {
    totalImpressions += parseFloat(row.impressions || "0");
    totalClicks += parseFloat(row.clicks || "0");
    totalSpend += parseFloat(row.spend || "0");
    totalReach += parseFloat(row.reach || "0");
  });

  return {
    creative,
    ads,
    metrics: {
      impressions: totalImpressions,
      clicks: totalClicks,
      spend: totalSpend,
      reach: totalReach,
      ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
    },
  };
}

// ============ Auth & Health ============

export async function getTokenInfo(): Promise<unknown> {
  const token = getToken();
  return graphRequest("/debug_token", {
    input_token: token,
  });
}

export async function healthCheck(): Promise<unknown> {
  try {
    const data = await graphRequest("/me", { fields: "id,name" });
    return { status: "ok", api_connected: true, ...(data as Record<string, unknown>) };
  } catch (error) {
    return {
      status: "error",
      api_connected: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
