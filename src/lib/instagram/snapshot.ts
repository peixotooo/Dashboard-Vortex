// Captura e persistência de snapshots do Instagram (seguidores + engajamento).
//
// Reutilizado por:
//   - /api/cron/instagram-snapshot  (diário, via admin client)
//   - /api/instagram/snapshot        (on-demand, botão "Atualizar agora")
//
// computeSnapshot() é puro (só scraping + matemática); persistSnapshot() grava.
// captureAndPersist() junta os dois. Manter a parte de scraping isolada deixa
// fácil testar/checar os números sem tocar no banco.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  scrapeInstagramProfile,
  scrapeInstagramPosts,
  type ApifyConfig,
  type InstagramProfile,
  type InstagramPost,
} from "@/lib/apify-api";
import { spDateString } from "@/lib/series-utils";
import { assertInstagramProfileContinuity } from "@/lib/instagram/profile";

// Re-export pra quem importa daqui (ex.: a rota de snapshot on-demand).
export { spDateString };

export type SnapshotSource = "cron" | "manual" | "backfill";

export interface SnapshotMetrics {
  postsSampled: number;
  avgLikes: number | null;
  avgComments: number | null;
  /** Percentual: (avgLikes + avgComments) / followers * 100. */
  engagementRate: number | null;
}

export interface CapturedSnapshot {
  profile: InstagramProfile;
  posts: InstagramPost[];
  metrics: SnapshotMetrics;
}

/** Quantos posts recentes amostrar para a taxa de engajamento. */
export const ENGAGEMENT_SAMPLE = 12;

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Calcula os agregados de engajamento sobre os posts mais recentes. */
export function computeEngagement(
  followers: number,
  posts: InstagramPost[],
  sampleSize = ENGAGEMENT_SAMPLE
): SnapshotMetrics {
  const sampled = [...posts]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, sampleSize);

  const n = sampled.length;
  if (n === 0) {
    return { postsSampled: 0, avgLikes: null, avgComments: null, engagementRate: null };
  }

  const totalLikes = sampled.reduce((s, p) => s + (p.likesCount || 0), 0);
  const totalComments = sampled.reduce((s, p) => s + (p.commentsCount || 0), 0);
  const avgLikes = totalLikes / n;
  const avgComments = totalComments / n;
  const engagementRate =
    followers > 0 ? ((avgLikes + avgComments) / followers) * 100 : null;

  return {
    postsSampled: n,
    avgLikes: round(avgLikes, 2),
    avgComments: round(avgComments, 2),
    engagementRate: engagementRate === null ? null : round(engagementRate, 4),
  };
}

/** Faz o scrape do perfil + posts recentes e calcula o snapshot (sem gravar). */
export async function computeSnapshot(
  config: ApifyConfig,
  username: string,
  postsLimit = 30
): Promise<CapturedSnapshot> {
  const [profile, posts] = await Promise.all([
    scrapeInstagramProfile(config, username),
    scrapeInstagramPosts(config, username, postsLimit),
  ]);

  const metrics = computeEngagement(profile.followersCount, posts);
  return { profile, posts, metrics };
}

/**
 * Grava o snapshot: atualiza o cache do perfil (instagram_profiles), faz upsert
 * dos posts recentes (instagram_posts) e grava/atualiza o ponto do dia
 * (instagram_snapshots). Usa o client passado (admin recomendado).
 */
export async function persistSnapshot(
  db: SupabaseClient,
  workspaceId: string,
  username: string,
  captured: CapturedSnapshot,
  source: SnapshotSource = "manual",
  capturedOn: string = spDateString()
): Promise<void> {
  const { profile, posts, metrics } = captured;
  const now = new Date().toISOString();

  const { data: previousProfile, error: previousProfileError } = await db
    .from("instagram_profiles")
    .select("followers_count, posts_count")
    .eq("workspace_id", workspaceId)
    .eq("username", username)
    .maybeSingle();
  if (previousProfileError) {
    throw new Error(`instagram_profiles: ${previousProfileError.message}`);
  }
  assertInstagramProfileContinuity(
    profile,
    previousProfile
      ? {
          followersCount: previousProfile.followers_count,
          postsCount: previousProfile.posts_count,
        }
      : null
  );

  // 1. Cache do perfil (último estado conhecido).
  const { error: profileError } = await db.from("instagram_profiles").upsert(
    {
      workspace_id: workspaceId,
      username: profile.username,
      full_name: profile.fullName,
      biography: profile.biography,
      followers_count: profile.followersCount,
      following_count: profile.followingCount,
      posts_count: profile.postsCount,
      profile_pic_url: profile.profilePicUrl,
      external_url: profile.externalUrl || null,
      business_category: profile.businessCategory || null,
      last_scraped_at: now,
    },
    { onConflict: "workspace_id,username" }
  );
  if (profileError) throw new Error(`instagram_profiles: ${profileError.message}`);

  // 2. Posts recentes (alimentam o ranking de engajamento na view).
  if (posts.length > 0) {
    const rows = posts.map((p) => ({
      workspace_id: workspaceId,
      profile_username: username,
      post_id: p.id,
      short_code: p.shortCode,
      url: p.url,
      type: p.type,
      caption: p.caption,
      hashtags: p.hashtags,
      likes_count: p.likesCount,
      comments_count: p.commentsCount,
      display_url: p.displayUrl,
      video_url: p.videoUrl || null,
      posted_at: p.timestamp,
      scraped_at: now,
    }));
    const { error: postsError } = await db
      .from("instagram_posts")
      .upsert(rows, { onConflict: "workspace_id,post_id" });
    if (postsError) throw new Error(`instagram_posts: ${postsError.message}`);
  }

  // 3. Ponto do dia na série temporal (1 por dia — re-rodar vira UPDATE).
  const { error: snapshotError } = await db.from("instagram_snapshots").upsert(
    {
      workspace_id: workspaceId,
      username,
      captured_on: capturedOn,
      captured_at: now,
      followers_count: profile.followersCount,
      following_count: profile.followingCount,
      posts_count: profile.postsCount,
      posts_sampled: metrics.postsSampled,
      avg_likes: metrics.avgLikes,
      avg_comments: metrics.avgComments,
      engagement_rate: metrics.engagementRate,
      source,
    },
    { onConflict: "workspace_id,username,captured_on" }
  );
  if (snapshotError) {
    throw new Error(`instagram_snapshots: ${snapshotError.message}`);
  }
}

/** Scrape + grava em um passo. Retorna o snapshot capturado. */
export async function captureAndPersist(
  db: SupabaseClient,
  config: ApifyConfig,
  workspaceId: string,
  username: string,
  opts: { postsLimit?: number; source?: SnapshotSource } = {}
): Promise<CapturedSnapshot> {
  const captured = await computeSnapshot(config, username, opts.postsLimit ?? 30);
  await persistSnapshot(db, workspaceId, username, captured, opts.source ?? "manual");
  return captured;
}

/**
 * Descobre qual @username o workspace acompanha. Se `explicit` vier preenchido,
 * usa ele; senão pega o perfil mais recente do instagram_profiles. Retorna null
 * se o workspace ainda não tem nenhum perfil cadastrado.
 */
export async function resolveTrackedUsername(
  db: SupabaseClient,
  workspaceId: string,
  explicit?: string | null
): Promise<string | null> {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed.replace(/^@/, "");

  const { data } = await db
    .from("instagram_profiles")
    .select("username")
    .eq("workspace_id", workspaceId)
    .order("last_scraped_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.username || null;
}
