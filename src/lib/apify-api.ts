import { decrypt } from "@/lib/encryption";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

// --- Types ---

export interface ApifyConfig {
  apiToken: string;
}

export interface InstagramProfile {
  username: string;
  fullName: string;
  biography: string;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  profilePicUrl: string;
  externalUrl?: string;
  businessCategory?: string;
}

export interface InstagramPost {
  id: string;
  shortCode: string;
  url: string;
  type: "Image" | "Video" | "Sidecar";
  timestamp: string;
  caption: string;
  hashtags: string[];
  likesCount: number;
  commentsCount: number;
  displayUrl: string;
  videoUrl?: string;
}

// --- Get config from database ---

export async function getApifyConfig(workspaceId?: string): Promise<ApifyConfig | null> {
  if (workspaceId) {
    try {
      const cookieStore = await cookies();
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return cookieStore.getAll();
            },
            setAll() {},
          },
        }
      );

      const { data } = await supabase
        .from("apify_connections")
        .select("api_token")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (data?.api_token) {
        return { apiToken: decrypt(data.api_token) };
      }
    } catch {
      // Fall through to env vars
    }
  }

  const token = process.env.APIFY_API_TOKEN;
  if (token) {
    return { apiToken: token };
  }

  return null;
}

// Same as getApifyConfig but reads the workspace token through a service-role
// admin client. Use from crons/background jobs where there is no session.
export async function getApifyConfigAdmin(
  admin: SupabaseClient,
  workspaceId: string
): Promise<ApifyConfig | null> {
  try {
    const { data } = await admin
      .from("apify_connections")
      .select("api_token")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (data?.api_token) {
      return { apiToken: decrypt(data.api_token) };
    }
  } catch {
    // Fall through to env var
  }

  const token = process.env.APIFY_API_TOKEN;
  return token ? { apiToken: token } : null;
}

// --- Apify API ---

const APIFY_BASE = "https://api.apify.com/v2";

async function runActorSync<T>(config: ApifyConfig, actorId: string, input: object): Promise<T[]> {
  const res = await fetch(
    `${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items?token=${config.apiToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify error (${res.status}): ${text}`);
  }

  return res.json();
}

// --- Instagram scraping ---

export async function scrapeInstagramProfile(
  config: ApifyConfig,
  username: string
): Promise<InstagramProfile> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = await runActorSync<any>(config, "apify~instagram-profile-scraper", {
    usernames: [username],
  });

  if (!items || items.length === 0) {
    throw new Error(`Profile not found: ${username}`);
  }

  const raw = items[0];
  return {
    username: raw.username || username,
    fullName: raw.fullName || raw.full_name || "",
    biography: raw.biography || raw.bio || "",
    followersCount: raw.followersCount ?? raw.followers ?? 0,
    followingCount: raw.followingCount ?? raw.following ?? 0,
    postsCount: raw.postsCount ?? raw.posts ?? 0,
    profilePicUrl: raw.profilePicUrl || raw.profilePicUrlHD || raw.profile_pic_url || "",
    externalUrl: raw.externalUrl || raw.external_url || undefined,
    businessCategory: raw.businessCategory || raw.category || undefined,
  };
}

export async function scrapeInstagramPosts(
  config: ApifyConfig,
  username: string,
  limit = 30
): Promise<InstagramPost[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = await runActorSync<any>(config, "apify~instagram-scraper", {
    directUrls: [`https://www.instagram.com/${username}/`],
    resultsType: "posts",
    resultsLimit: limit,
  });

  if (!items || items.length === 0) {
    return [];
  }

  return items.map((raw) => ({
    id: raw.id || raw.pk || raw.shortCode || raw.code || String(Date.now()),
    shortCode: raw.shortCode || raw.code || "",
    url: raw.url || `https://www.instagram.com/p/${raw.shortCode || raw.code}/`,
    type: normalizePostType(raw.type || raw.productType || raw.mediaType),
    timestamp: parseInstagramTimestamp(
      raw.timestamp ?? raw.taken_at ?? raw.takenAtTimestamp
    ),
    caption: raw.caption || raw.text || "",
    hashtags: raw.hashtags || extractHashtags(raw.caption || raw.text || ""),
    likesCount: raw.likesCount ?? raw.likes ?? 0,
    commentsCount: raw.commentsCount ?? raw.comments ?? 0,
    displayUrl: raw.displayUrl || raw.display_url || raw.imageUrl || raw.thumbnailUrl || "",
    videoUrl: raw.videoUrl || raw.video_url || undefined,
  }));
}

function parseInstagramTimestamp(value: unknown): string {
  if (value == null || value === "") return new Date().toISOString();

  if (typeof value === "number") {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
  }

  const raw = String(value).trim();
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && raw !== "") {
    const millis = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(millis);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
  }

  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();

  return new Date().toISOString();
}

function normalizePostType(type: string | number | undefined): "Image" | "Video" | "Sidecar" {
  if (!type) return "Image";
  const t = String(type).toLowerCase();
  if (t.includes("video") || t.includes("reel") || t === "2") return "Video";
  if (t.includes("sidecar") || t.includes("carousel") || t === "8") return "Sidecar";
  return "Image";
}

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\w\u00C0-\u024F]+/g);
  return matches || [];
}
