import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import { getBioConfigByWorkspace, isMissingBioTable } from "@/lib/bio/config";
import type { BioEventInput } from "@/lib/bio/types";

const VALID_EVENTS = new Set([
  "bio_viewed",
  "bio_block_viewed",
  "bio_cta_clicked",
  "bio_product_clicked",
  "bio_category_clicked",
  "bio_group_clicked",
  "bio_club_clicked",
  "bio_shipping_clicked",
  "bio_review_clicked",
]);

const ALWAYS_ALLOWED_HOSTS = new Set([
  "bulking.com.br",
  "www.bulking.com.br",
  "bio.bulking.com.br",
  "grupos.bulking.com.br",
  "chat.whatsapp.com",
  "wa.me",
  "api.whatsapp.com",
]);

function cleanText(value: unknown, max = 512): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function normalizeSessionId(value: unknown): string | null {
  const raw = cleanText(value, 128);
  if (!raw || !/^[a-zA-Z0-9_-]+$/.test(raw)) return null;
  return raw;
}

export function parseUtm(url: URL) {
  return {
    source: cleanText(url.searchParams.get("utm_source"), 80),
    medium: cleanText(url.searchParams.get("utm_medium"), 80),
    campaign: cleanText(url.searchParams.get("utm_campaign"), 160),
    content: cleanText(url.searchParams.get("utm_content"), 160),
  };
}

export function getDeviceFromUserAgent(userAgent: string | null): string {
  const ua = (userAgent || "").toLowerCase();
  if (/mobile|iphone|android/.test(ua)) return "mobile";
  if (/ipad|tablet/.test(ua)) return "tablet";
  return "desktop";
}

export async function recordBioEvent(
  input: BioEventInput,
  db: SupabaseClient = createAdminClient()
): Promise<void> {
  if (!input.workspaceId || !VALID_EVENTS.has(input.eventName)) return;

  const sessionId = normalizeSessionId(input.sessionId) || null;
  const metadata = {
    ...(input.metadata || {}),
    device: getDeviceFromUserAgent(input.userAgent || null),
  };

  const { error } = await db.from("bio_page_events").insert({
    workspace_id: input.workspaceId,
    session_id: sessionId,
    event_name: input.eventName,
    block_id: cleanText(input.blockId, 96),
    block_type: cleanText(input.blockType, 64),
    destination_url: cleanText(input.destinationUrl, 1000),
    product_id: cleanText(input.productId, 128),
    category: cleanText(input.category, 160),
    campaign_id: cleanText(input.campaignId, 128),
    referrer: cleanText(input.referrer, 1000),
    user_agent: cleanText(input.userAgent, 1000),
    utm_source: cleanText(input.source, 120),
    utm_medium: cleanText(input.medium, 120),
    utm_campaign: cleanText(input.campaign, 180),
    utm_content: cleanText(input.content, 180),
    metadata,
  });

  if (error && !isMissingBioTable(error)) {
    console.warn("[bio tracking] failed to record event", error.message);
  }
}

function safeHost(hostname: string, allowedHosts: Set<string>): boolean {
  const host = hostname.toLowerCase();
  if (allowedHosts.has(host)) return true;
  return host.endsWith(".bulking.com.br");
}

export async function buildTrackedDestination(params: {
  workspaceId: string;
  destinationUrl: string;
  blockId?: string | null;
  defaultCampaign?: string | null;
  requestUrl?: URL;
}): Promise<string | null> {
  const raw = params.destinationUrl.trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = raw.startsWith("/")
      ? new URL(raw, "https://www.bulking.com.br")
      : new URL(raw);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return null;

  const allowedHosts = new Set(ALWAYS_ALLOWED_HOSTS);
  try {
    const config = await getBioConfigByWorkspace(params.workspaceId);
    if (config.public_domain) allowedHosts.add(config.public_domain.toLowerCase());
    if (config.store_base_url) allowedHosts.add(new URL(config.store_base_url).hostname.toLowerCase());
  } catch {
    // Defaults already protect the redirect.
  }

  if (!safeHost(parsed.hostname, allowedHosts)) return null;

  if (parsed.hostname.endsWith("bulking.com.br")) {
    parsed.searchParams.set("utm_source", params.requestUrl?.searchParams.get("utm_source") || "instagram");
    parsed.searchParams.set("utm_medium", params.requestUrl?.searchParams.get("utm_medium") || "bio");
    parsed.searchParams.set(
      "utm_campaign",
      params.requestUrl?.searchParams.get("utm_campaign") || params.defaultCampaign || "instagram_bio"
    );
    if (params.blockId) parsed.searchParams.set("utm_content", params.blockId);
  }

  return parsed.toString();
}
