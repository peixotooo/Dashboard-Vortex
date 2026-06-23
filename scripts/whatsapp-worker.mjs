import { createDecipheriv } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: process.env.WA_WORKER_ENV || ".env.worker" });
dotenv.config({ path: ".env.local" });

const DEFAULT_KINDS = ["gift_request", "campaign", "cart_recovery"];
const ALGORITHM = "aes-256-gcm";

const env = (name, fallback = "") => {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return String(value).trim();
};

const numberEnv = (name, fallback) => {
  const value = Number(env(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ENCRYPTION_KEY = env("ENCRYPTION_KEY");
const CRON_SECRET = env("CRON_SECRET");
const CRON_BASE_URL = env(
  "WA_WORKER_CRON_BASE_URL",
  env("NEXT_PUBLIC_APP_URL")
).replace(/\/+$/, "");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ENCRYPTION_KEY) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or ENCRYPTION_KEY"
  );
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BATCH_SIZE = numberEnv("WA_WORKER_BATCH_SIZE", 200);
const PARALLEL = numberEnv("WA_WORKER_PARALLEL", 10);
const LOOP_DELAY_MS = numberEnv("WA_WORKER_LOOP_DELAY_MS", 2000);
const ERROR_DELAY_MS = numberEnv("WA_WORKER_ERROR_DELAY_MS", 10000);
const GIFT_LIMIT = numberEnv("WA_WORKER_GIFT_LIMIT", 50);
const MANUAL_LIMIT = numberEnv("WA_WORKER_MANUAL_LIMIT", 3);
const CART_LIMIT = numberEnv("WA_WORKER_CART_LIMIT", 25);
const SEND_RETRY_ATTEMPTS = numberEnv("WA_WORKER_SEND_RETRY_ATTEMPTS", 3);
const STALE_SENDING_MINUTES = numberEnv("WA_WORKER_STALE_SENDING_MINUTES", 120);
const STALE_SENDING_MS = STALE_SENDING_MINUTES * 60 * 1000;
const RETRY_BASE_DELAY_MS = numberEnv("WA_WORKER_RETRY_BASE_DELAY_MS", 1500);
const JOB_TIMEOUT_MS = numberEnv("WA_WORKER_JOB_TIMEOUT_MS", 10 * 60 * 1000);
const MAINTENANCE_JOBS_ENABLED = env("WA_WORKER_MAINTENANCE_JOBS", "true") !== "false";
const ENABLED_KINDS = new Set(
  env("WA_WORKER_KINDS", DEFAULT_KINDS.join(","))
    .split(",")
    .map((kind) => kind.trim())
    .filter(Boolean)
);

const DUE_FILTER =
  "status.eq.queued,status.eq.sending,and(status.eq.scheduled,scheduled_at.lte.now())";
const CAMPAIGN_SELECT =
  "id, workspace_id, template_id, variable_values, status, scheduled_at, kind";

let stopping = false;
const waConfigCache = new Map();
const templateCache = new Map();
const templateRecheckCache = new Map();
const exclusionCache = new Map();

function nextUtcDailyRun(hour, minute = 0) {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime();
}

function nextUtcHourlyRun(minute = 0) {
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes(minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCHours(next.getUTCHours() + 1);
  }
  return next.getTime();
}

function nextUtcEveryHoursRun(hours, minute = 0) {
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes(minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCHours(next.getUTCHours() + 1);
  }
  while (next.getUTCHours() % hours !== 0) {
    next.setUTCHours(next.getUTCHours() + 1);
  }
  return next.getTime();
}

const maintenanceJobs = [
  {
    name: "cart-recovery-import",
    path: "/api/cron/cart-recovery-import",
    intervalMs: numberEnv("WA_WORKER_CART_IMPORT_INTERVAL_MS", 15 * 60 * 1000),
    nextRunAt: 0,
    running: false,
  },
  {
    name: "cart-recovery",
    path: "/api/cron/cart-recovery",
    intervalMs: numberEnv("WA_WORKER_CART_RECOVERY_INTERVAL_MS", 5 * 60 * 1000),
    nextRunAt: 0,
    running: false,
  },
  {
    name: "gift-request-conversions",
    path: "/api/cron/gift-request-conversions",
    intervalMs: numberEnv("WA_WORKER_GIFT_MAINTENANCE_INTERVAL_MS", 30 * 60 * 1000),
    nextRunAt: 0,
    running: false,
  },
  {
    name: "wapi-group-sender",
    path: "/api/cron/wapi-group-sender",
    intervalMs: numberEnv("WA_WORKER_WAPI_GROUP_INTERVAL_MS", 5 * 60 * 1000),
    nextRunAt: 0,
    running: false,
  },
  {
    name: "wapi-group-invite-links",
    path: "/api/cron/wapi-group-invite-links",
    intervalMs: numberEnv("WA_WORKER_WAPI_INVITE_LINK_INTERVAL_MS", 60 * 1000),
    nextRunAt: 0,
    running: false,
  },
  {
    name: "review-requests",
    path: "/api/cron/review-requests",
    intervalMs: numberEnv("WA_WORKER_REVIEW_REQUESTS_INTERVAL_MS", 30 * 60 * 1000),
    nextRunAt: 0,
    running: false,
  },
  {
    name: "cashback-tick",
    path: "/api/cron/cashback-tick",
    intervalMs: numberEnv("WA_WORKER_CASHBACK_TICK_INTERVAL_MS", 24 * 60 * 60 * 1000),
    nextRunAt: nextUtcDailyRun(12),
    running: false,
  },
  {
    name: "coupon-jobs",
    path: "/api/cron/coupon-jobs",
    intervalMs: numberEnv("WA_WORKER_COUPON_JOBS_INTERVAL_MS", 60 * 1000),
    nextRunAt: 0,
    running: false,
  },
  {
    name: "coupon-refresh",
    path: "/api/cron/coupon-refresh",
    intervalMs: numberEnv("WA_WORKER_COUPON_REFRESH_INTERVAL_MS", 24 * 60 * 60 * 1000),
    nextRunAt: nextUtcDailyRun(9),
    running: false,
  },
  {
    name: "coupon-attribution",
    path: "/api/cron/coupon-attribution",
    intervalMs: numberEnv("WA_WORKER_COUPON_ATTRIBUTION_INTERVAL_MS", 6 * 60 * 60 * 1000),
    nextRunAt: nextUtcEveryHoursRun(6),
    running: false,
  },
  {
    name: "pricing-jobs",
    path: "/api/cron/pricing-jobs",
    intervalMs: numberEnv("WA_WORKER_PRICING_JOBS_INTERVAL_MS", 60 * 1000),
    nextRunAt: 0,
    running: false,
  },
  {
    name: "pricing-engine",
    path: "/api/cron/pricing-engine",
    intervalMs: numberEnv("WA_WORKER_PRICING_ENGINE_INTERVAL_MS", 24 * 60 * 60 * 1000),
    nextRunAt: nextUtcDailyRun(5),
    running: false,
  },
  {
    name: "email-templates-refresh",
    path: "/api/cron/email-templates-refresh",
    intervalMs: numberEnv("WA_WORKER_EMAIL_REFRESH_INTERVAL_MS", 24 * 60 * 60 * 1000),
    nextRunAt: nextUtcDailyRun(9),
    running: false,
  },
  {
    name: "email-templates-safety-net",
    path: "/api/cron/email-templates-safety-net",
    intervalMs: numberEnv("WA_WORKER_EMAIL_SAFETY_INTERVAL_MS", 60 * 60 * 1000),
    nextRunAt: nextUtcHourlyRun(30),
    running: false,
  },
  {
    name: "email-templates-stats-sync",
    path: "/api/cron/email-templates-stats-sync",
    intervalMs: numberEnv("WA_WORKER_EMAIL_STATS_INTERVAL_MS", 6 * 60 * 60 * 1000),
    nextRunAt: nextUtcEveryHoursRun(6),
    running: false,
  },
  {
    name: "iporto-dispatcher-1",
    path: "/api/cron/iporto-dispatcher",
    intervalMs: numberEnv("WA_WORKER_IPORTO_DISPATCH_INTERVAL_MS", 60 * 1000),
    nextRunAt: 0,
    running: false,
  },
  {
    name: "iporto-dispatcher-2",
    path: "/api/cron/iporto-dispatcher-2",
    intervalMs: numberEnv("WA_WORKER_IPORTO_DISPATCH_INTERVAL_MS", 60 * 1000),
    nextRunAt: 0,
    running: false,
  },
  {
    name: "iporto-dispatcher-3",
    path: "/api/cron/iporto-dispatcher-3",
    intervalMs: numberEnv("WA_WORKER_IPORTO_DISPATCH_INTERVAL_MS", 60 * 1000),
    nextRunAt: 0,
    running: false,
  },
];

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

function log(message, extra) {
  const suffix = extra == null ? "" : ` ${JSON.stringify(extra)}`;
  console.log(`[${new Date().toISOString()}] ${message}${suffix}`);
}

function compactLogBody(body) {
  if (!body || typeof body !== "object") return body;

  const json = JSON.stringify(body);
  if (json.length <= 2000) return body;
  return {
    truncated: true,
    preview: json.slice(0, 2000),
  };
}

function decrypt(encryptedText) {
  if (!encryptedText || !String(encryptedText).includes(":")) {
    return encryptedText;
  }

  const parts = String(encryptedText).split(":");
  if (parts.length !== 3) return encryptedText;

  const key = Buffer.from(ENCRYPTION_KEY, "hex");
  const [ivHex, authTagHex, encrypted] = parts;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function normalizeBrazilianWhatsAppPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
}

function sanitizeTemplateTextParam(value) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {5,}/g, "    ")
    .trim();
}

async function getWaConfig(workspaceId) {
  const cached = waConfigCache.get(workspaceId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { data, error } = await db
    .from("wa_config")
    .select("phone_number_id, waba_id, access_token, display_phone")
    .eq("workspace_id", workspaceId)
    .single();

  if (error || !data?.phone_number_id || !data?.access_token) {
    return null;
  }

  const value = {
    phoneNumberId: data.phone_number_id,
    wabaId: data.waba_id,
    accessToken: decrypt(data.access_token),
    displayPhone: data.display_phone || undefined,
  };
  waConfigCache.set(workspaceId, {
    value,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  return value;
}

async function getTemplate(templateId) {
  const cached = templateCache.get(templateId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { data, error } = await db
    .from("wa_templates")
    .select("id, meta_id, name, language, status, category")
    .eq("id", templateId)
    .single();

  if (error || !data) return null;
  templateCache.set(templateId, {
    value: data,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  return data;
}

async function recheckTemplateOnMeta(config, template) {
  if (!template?.meta_id) {
    return {
      ok: false,
      changed: false,
      previousCategory: template?.category || null,
      currentCategory: null,
      previousStatus: template?.status || null,
      currentStatus: null,
      reason: "missing_meta_id",
    };
  }

  const cacheKey = template.id;
  const cached = templateRecheckCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${template.meta_id}?fields=id,name,language,category,status,components`,
    {
      headers: { Authorization: `Bearer ${config.accessToken}` },
    }
  );

  if (!res.ok) {
    const value = {
      ok: false,
      changed: false,
      previousCategory: template.category || null,
      currentCategory: null,
      previousStatus: template.status || null,
      currentStatus: null,
      reason: `meta_fetch_failed_${res.status}`,
    };
    templateRecheckCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + 2 * 60 * 1000,
    });
    return value;
  }

  const live = await res.json();
  const changed =
    live.category !== template.category || live.status !== template.status;
  if (changed) {
    await db
      .from("wa_templates")
      .update({
        category: live.category,
        status: live.status,
        components: live.components || [],
        synced_at: new Date().toISOString(),
      })
      .eq("id", template.id);
  } else {
    await db
      .from("wa_templates")
      .update({ synced_at: new Date().toISOString() })
      .eq("id", template.id);
  }

  const value = {
    ok: true,
    changed,
    previousCategory: template.category || null,
    currentCategory: live.category || null,
    previousStatus: template.status || null,
    currentStatus: live.status || null,
  };
  templateRecheckCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  return value;
}

async function getExcludedPhones(workspaceId) {
  const cached = exclusionCache.get(workspaceId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const phones = new Set();
  let from = 0;
  const pageSize = 5000;

  while (true) {
    const { data, error } = await db
      .from("wa_exclusions")
      .select("phone")
      .eq("workspace_id", workspaceId)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) phones.add(String(row.phone || "").replace(/\D/g, ""));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  exclusionCache.set(workspaceId, {
    value: phones,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return phones;
}

async function sendTemplateMessage(config, phone, templateName, language, variables) {
  const to = normalizeBrazilianWhatsAppPhone(phone);
  if (!to) return { messageId: null, error: "invalid_phone" };

  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
    },
  };

  if (variables && Object.keys(variables).length > 0) {
    body.template.components = [
      {
        type: "body",
        parameters: Object.values(variables).map((value) => ({
          type: "text",
          text: sanitizeTemplateTextParam(value),
        })),
      },
    ];
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { messageId: null, error: `HTTP ${res.status}: ${text.slice(0, 500)}` };
    }

    const json = await res.json();
    return { messageId: json.messages?.[0]?.id || null, error: null };
  } catch (error) {
    return {
      messageId: null,
      error: error instanceof Error ? error.message : "send_failed",
    };
  }
}

function isTransientSendError(error) {
  const value = String(error || "").toLowerCase();
  return (
    value.includes("http 429") ||
    value.includes("http 500") ||
    value.includes("http 502") ||
    value.includes("http 503") ||
    value.includes("http 504") ||
    value.includes("fetch failed") ||
    value.includes("timeout") ||
    value.includes("econnreset") ||
    value.includes("etimedout") ||
    value.includes("socket") ||
    value.includes("temporar")
  );
}

async function sendTemplateMessageWithRetries(
  config,
  phone,
  templateName,
  language,
  variables
) {
  let lastResult = { messageId: null, error: "send_failed" };

  for (let attempt = 1; attempt <= SEND_RETRY_ATTEMPTS && !stopping; attempt++) {
    const result = await sendTemplateMessage(
      config,
      phone,
      templateName,
      language,
      variables
    );
    if (result.messageId || !isTransientSendError(result.error)) {
      return result;
    }

    lastResult = result;
    if (attempt < SEND_RETRY_ATTEMPTS) {
      await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }

  return {
    messageId: null,
    error: `${lastResult.error || "send_failed"} (retried ${SEND_RETRY_ATTEMPTS}x)`,
  };
}

async function triggerMaintenanceJob(job) {
  if (!MAINTENANCE_JOBS_ENABLED || !CRON_BASE_URL || !CRON_SECRET || job.running) {
    return;
  }

  job.running = true;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), JOB_TIMEOUT_MS);

  try {
    const res = await fetch(`${CRON_BASE_URL}${job.path}`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    let body = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {}

    log("maintenance job finished", {
      name: job.name,
      status: res.status,
      durationMs: Date.now() - startedAt,
      body: compactLogBody(body),
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `timeout_after_${JOB_TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    log("maintenance job failed", {
      name: job.name,
      durationMs: Date.now() - startedAt,
      message,
    });
  } finally {
    globalThis.clearTimeout(timeout);
    job.running = false;
  }
}

function scheduleDueMaintenanceJobs() {
  if (!MAINTENANCE_JOBS_ENABLED || !CRON_BASE_URL || !CRON_SECRET) return;

  const now = Date.now();
  for (const job of maintenanceJobs) {
    if (job.running || job.nextRunAt > now) continue;
    job.nextRunAt = now + job.intervalMs;
    void triggerMaintenanceJob(job);
  }
}

async function fetchCampaignsByKind(kind, limit) {
  const { data, error } = await db
    .from("wa_campaigns")
    .select(CAMPAIGN_SELECT)
    .eq("kind", kind)
    .or(DUE_FILTER)
    .order(kind === "cart_recovery" ? "created_at" : "scheduled_at", {
      ascending: true,
      nullsFirst: false,
    })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

async function fetchDueCampaigns() {
  const groups = [];
  if (ENABLED_KINDS.has("gift_request")) {
    groups.push(await fetchCampaignsByKind("gift_request", GIFT_LIMIT));
  }
  if (ENABLED_KINDS.has("campaign")) {
    groups.push(await fetchCampaignsByKind("campaign", MANUAL_LIMIT));
  }
  if (ENABLED_KINDS.has("cart_recovery")) {
    groups.push(await fetchCampaignsByKind("cart_recovery", CART_LIMIT));
  }

  const seen = new Set();
  const campaigns = [];
  for (const row of groups.flat()) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    campaigns.push(row);
  }
  return campaigns;
}

async function cancelConvertedGiftRequestMessages() {
  if (!ENABLED_KINDS.has("gift_request")) return;

  const { data, error } = await db
    .from("gift_requests")
    .select("id, wa_message_id")
    .eq("status", "converted")
    .not("wa_message_id", "is", null)
    .limit(500);

  if (error) throw error;

  const messageIds = (data || [])
    .map((row) => row.wa_message_id)
    .filter(Boolean);
  if (messageIds.length === 0) return;

  const { data: messages, error: msgError } = await db
    .from("wa_messages")
    .select("id, campaign_id")
    .in("id", messageIds)
    .in("status", ["queued", "sending"]);

  if (msgError) throw msgError;
  if (!messages || messages.length === 0) return;

  const ids = messages.map((row) => row.id);
  const campaignIds = Array.from(
    new Set(messages.map((row) => row.campaign_id).filter(Boolean))
  );

  await db
    .from("wa_messages")
    .update({ status: "canceled", error_message: "gift_request_already_converted" })
    .in("id", ids);

  if (campaignIds.length > 0) {
    await db
      .from("wa_campaigns")
      .update({ status: "canceled", completed_at: new Date().toISOString() })
      .in("id", campaignIds)
      .in("status", ["queued", "scheduled", "sending"]);
  }

  log("canceled converted gift request messages", { count: ids.length });
}

async function markCampaignSending(campaign) {
  if (campaign.status !== "queued" && campaign.status !== "scheduled") return;
  await db
    .from("wa_campaigns")
    .update({ status: "sending", started_at: new Date().toISOString() })
    .eq("id", campaign.id);
}

async function claimQueuedMessages(campaignId) {
  const { data: rows, error } = await db
    .from("wa_messages")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("status", "queued")
    .limit(BATCH_SIZE);

  if (error) throw error;
  const ids = (rows || []).map((row) => row.id);
  if (ids.length === 0) return [];

  const { data: claimed, error: claimError } = await db
    .from("wa_messages")
    .update({ status: "sending" })
    .in("id", ids)
    .eq("status", "queued")
    .select("id, phone, contact_name, variable_values");

  if (claimError) throw claimError;
  return claimed || [];
}

async function completeCampaignIfDone(campaignId) {
  const [{ count: queued }, { count: sending }] = await Promise.all([
    db
      .from("wa_messages")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "queued"),
    db
      .from("wa_messages")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "sending"),
  ]);

  if ((queued ?? 0) === 0 && (sending ?? 0) === 0) {
    await db
      .from("wa_campaigns")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", campaignId)
      .in("status", ["queued", "scheduled", "sending"]);
  }
}

async function recoverStaleSendingCampaigns() {
  const cutoff = new Date(Date.now() - STALE_SENDING_MS).toISOString();
  const { data: campaigns, error } = await db
    .from("wa_campaigns")
    .select("id, kind, started_at")
    .eq("status", "sending")
    .lt("started_at", cutoff)
    .limit(100);

  if (error) throw error;
  if (!campaigns || campaigns.length === 0) return 0;

  let recoveredMessages = 0;
  let recoveredCampaigns = 0;

  for (const campaign of campaigns) {
    const { data: messages, error: msgError } = await db
      .from("wa_messages")
      .update({
        status: "queued",
        error_message: `worker_recovered_stale_sending_after_${STALE_SENDING_MINUTES}m`,
      })
      .eq("campaign_id", campaign.id)
      .eq("status", "sending")
      .is("sent_at", null)
      .select("id");

    if (msgError) throw msgError;
    recoveredMessages += messages?.length || 0;

    const [{ count: queued }, { count: sending }] = await Promise.all([
      db
        .from("wa_messages")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign.id)
        .eq("status", "queued"),
      db
        .from("wa_messages")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign.id)
        .eq("status", "sending"),
    ]);

    if ((queued || 0) > 0 && (sending || 0) === 0) {
      await db
        .from("wa_campaigns")
        .update({ status: "queued" })
        .eq("id", campaign.id)
        .eq("status", "sending");
      recoveredCampaigns++;
    }
  }

  if (recoveredMessages > 0 || recoveredCampaigns > 0) {
    log("recovered stale sending campaigns", {
      campaigns: recoveredCampaigns,
      messages: recoveredMessages,
    });
  }

  return recoveredMessages;
}

async function recoverOrphanSendingMessages() {
  const cutoff = new Date(Date.now() - STALE_SENDING_MS).toISOString();
  const { data: messages, error } = await db
    .from("wa_messages")
    .select("id, campaign_id, sent_at, created_at")
    .eq("status", "sending")
    .lt("created_at", cutoff)
    .limit(500);

  if (error) throw error;
  if (!messages || messages.length === 0) return 0;

  const campaignIds = Array.from(
    new Set(messages.map((row) => row.campaign_id).filter(Boolean))
  );
  const campaignStatus = new Map();

  if (campaignIds.length > 0) {
    const { data: campaigns, error: campaignError } = await db
      .from("wa_campaigns")
      .select("id, status")
      .in("id", campaignIds);

    if (campaignError) throw campaignError;
    for (const campaign of campaigns || []) {
      campaignStatus.set(campaign.id, campaign.status);
    }
  }

  const sentIds = [];
  const failedIds = [];
  for (const message of messages) {
    if (message.sent_at) {
      sentIds.push(message.id);
      continue;
    }

    if (campaignStatus.get(message.campaign_id) !== "sending") {
      failedIds.push(message.id);
    }
  }

  if (sentIds.length > 0) {
    await db.from("wa_messages").update({ status: "sent" }).in("id", sentIds);
  }

  if (failedIds.length > 0) {
    await db
      .from("wa_messages")
      .update({
        status: "failed",
        error_message: `worker_recovered_orphan_sending_after_${STALE_SENDING_MINUTES}m`,
      })
      .in("id", failedIds);
  }

  if (sentIds.length > 0 || failedIds.length > 0) {
    log("recovered orphan sending messages", {
      sent: sentIds.length,
      failed: failedIds.length,
    });
  }

  return sentIds.length + failedIds.length;
}

async function updateCartRecoveryLogsByMessageIds(messageIds, patch) {
  for (let i = 0; i < messageIds.length; i += 100) {
    const chunk = messageIds.slice(i, i + 100).map(String);
    if (chunk.length === 0) continue;
    await db
      .from("cart_recovery_messages")
      .update(patch)
      .eq("channel", "whatsapp")
      .in("external_id", chunk);
  }
}

async function incrementCampaignCounters(campaignId, sent, failed) {
  if (sent === 0 && failed === 0) return;

  const { data } = await db
    .from("wa_campaigns")
    .select("sent_count, failed_count")
    .eq("id", campaignId)
    .single();

  if (!data) return;
  await db
    .from("wa_campaigns")
    .update({
      sent_count: (data.sent_count || 0) + sent,
      failed_count: (data.failed_count || 0) + failed,
    })
    .eq("id", campaignId);
}

async function processCampaign(campaign) {
  await markCampaignSending(campaign);

  if (!campaign.template_id) {
    await db.from("wa_campaigns").update({ status: "failed" }).eq("id", campaign.id);
    return 0;
  }

  const [config, template] = await Promise.all([
    getWaConfig(campaign.workspace_id),
    getTemplate(campaign.template_id),
  ]);

  if (!config || !template) {
    await db.from("wa_campaigns").update({ status: "failed" }).eq("id", campaign.id);
    return 0;
  }

  const recheck = await recheckTemplateOnMeta(config, template);
  if (
    recheck.ok &&
    recheck.previousCategory &&
    recheck.previousCategory !== "MARKETING" &&
    recheck.currentCategory === "MARKETING"
  ) {
    const reason = `Template ${template.name} was reclassified as MARKETING by Meta.`;
    await db.from("wa_campaigns").update({ status: "failed" }).eq("id", campaign.id);
    await db
      .from("wa_messages")
      .update({ status: "canceled", error_message: reason })
      .eq("campaign_id", campaign.id)
      .eq("status", "queued");
    return 0;
  }

  if (recheck.ok && recheck.currentStatus && recheck.currentStatus !== "APPROVED") {
    await db.from("wa_campaigns").update({ status: "failed" }).eq("id", campaign.id);
    await db
      .from("wa_messages")
      .update({ status: "canceled", error_message: `template_${recheck.currentStatus}` })
      .eq("campaign_id", campaign.id)
      .eq("status", "queued");
    return 0;
  }

  const effectiveTemplateStatus =
    recheck.ok && recheck.currentStatus ? recheck.currentStatus : template.status;
  if (effectiveTemplateStatus && effectiveTemplateStatus !== "APPROVED") {
    await db.from("wa_campaigns").update({ status: "failed" }).eq("id", campaign.id);
    return 0;
  }

  const messages = await claimQueuedMessages(campaign.id);
  if (messages.length === 0) {
    await completeCampaignIfDone(campaign.id);
    return 0;
  }

  const excludedPhones = await getExcludedPhones(campaign.workspace_id);
  const blocked = [];
  const toSend = [];

  for (const message of messages) {
    const phone = String(message.phone || "").replace(/\D/g, "");
    if (excludedPhones.has(phone)) blocked.push(message.id);
    else toSend.push(message);
  }

  if (blocked.length > 0) {
    await db
      .from("wa_messages")
      .update({ status: "failed", error_message: "Blocked by exclusion list" })
      .in("id", blocked);
    if (campaign.kind === "cart_recovery") {
      await updateCartRecoveryLogsByMessageIds(blocked, {
        status: "failed",
        error: "Blocked by exclusion list",
      });
    }
  }

  const sentResults = [];
  const failedResults = [];

  for (let i = 0; i < toSend.length && !stopping; i += PARALLEL) {
    const chunk = toSend.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      chunk.map(async (message) => {
        const variables = {
          ...(campaign.variable_values || {}),
          ...(message.variable_values || {}),
        };
        const result = await sendTemplateMessageWithRetries(
          config,
          message.phone,
          template.name,
          template.language,
          Object.keys(variables).length > 0 ? variables : undefined
        );
        return { id: message.id, ...result };
      })
    );

    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      if (result.status === "fulfilled" && result.value.messageId) {
        sentResults.push({ id: result.value.id, messageId: result.value.messageId });
      } else {
        const id =
          result.status === "fulfilled" ? result.value.id : chunk[index]?.id;
        const error =
          result.status === "fulfilled"
            ? result.value.error || "send_failed"
            : result.reason instanceof Error
              ? result.reason.message
              : "send_rejected";
        if (id) failedResults.push({ id, error });
      }
    }
  }

  if (sentResults.length > 0) {
    const now = new Date().toISOString();
    await db
      .from("wa_messages")
      .update({ status: "sent", sent_at: now })
      .in("id", sentResults.map((row) => row.id));

    if (campaign.kind === "cart_recovery") {
      await updateCartRecoveryLogsByMessageIds(
        sentResults.map((row) => row.id),
        { status: "sent", error: null }
      );
    }

    for (const row of sentResults) {
      await db
        .from("wa_messages")
        .update({ meta_message_id: row.messageId })
        .eq("id", row.id);
    }
  }

  if (failedResults.length > 0) {
    const byError = new Map();
    for (const row of failedResults) {
      const key = String(row.error || "send_failed").slice(0, 500);
      if (!byError.has(key)) byError.set(key, []);
      byError.get(key).push(row.id);
    }
    for (const [error, ids] of byError.entries()) {
      await db.from("wa_messages").update({ status: "failed", error_message: error }).in("id", ids);
      if (campaign.kind === "cart_recovery") {
        await updateCartRecoveryLogsByMessageIds(ids, {
          status: "failed",
          error,
        });
      }
    }
  }

  const sent = sentResults.length;
  const failed = blocked.length + failedResults.length;
  await incrementCampaignCounters(campaign.id, sent, failed);
  await completeCampaignIfDone(campaign.id);

  log("processed campaign", {
    id: campaign.id,
    kind: campaign.kind,
    sent,
    failed,
    claimed: messages.length,
  });

  return sent + failed;
}

async function processOnce() {
  scheduleDueMaintenanceJobs();
  await recoverStaleSendingCampaigns();
  await recoverOrphanSendingMessages();
  await cancelConvertedGiftRequestMessages();
  const campaigns = await fetchDueCampaigns();
  if (campaigns.length === 0) return 0;

  let processed = 0;
  for (const campaign of campaigns) {
    if (stopping) break;
    processed += await processCampaign(campaign);
  }
  return processed;
}

async function main() {
  log("worker started", {
    kinds: Array.from(ENABLED_KINDS),
    batchSize: BATCH_SIZE,
    parallel: PARALLEL,
    sendRetryAttempts: SEND_RETRY_ATTEMPTS,
    staleSendingMinutes: STALE_SENDING_MINUTES,
    jobTimeoutMs: JOB_TIMEOUT_MS,
    maintenanceJobs: MAINTENANCE_JOBS_ENABLED && Boolean(CRON_BASE_URL && CRON_SECRET),
    maintenanceJobCount: maintenanceJobs.length,
  });

  if (MAINTENANCE_JOBS_ENABLED && (!CRON_BASE_URL || !CRON_SECRET)) {
    log("maintenance jobs disabled because CRON_SECRET or base URL is missing");
  }

  while (!stopping) {
    try {
      const processed = await processOnce();
      if (processed === 0) await sleep(LOOP_DELAY_MS);
    } catch (error) {
      log("worker error", {
        message: error instanceof Error ? error.message : String(error),
      });
      await sleep(ERROR_DELAY_MS);
    }
  }

  log("worker stopped");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
