import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError, AuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { resolveTrackedUsername } from "@/lib/instagram/snapshot";
import {
  shiftDays,
  daysBetween,
  toLabel,
  makeDelta,
  refByDaysAgo,
} from "@/lib/series-utils";

interface SnapshotRow {
  captured_on: string;
  followers_count: number;
  following_count: number;
  posts_count: number;
  avg_likes: number | null;
  avg_comments: number | null;
  engagement_rate: number | null;
}

interface SeriesPoint {
  date: string; // YYYY-MM-DD
  label: string; // DD/MM
  followers: number;
  following: number;
  posts: number;
  avgLikes: number | null;
  avgComments: number | null;
  engagementRate: number | null;
  dailyDelta: number | null; // vs ponto anterior
}

// GET /api/instagram/snapshots?username=xxx&days=90
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();
    const username = await resolveTrackedUsername(
      admin,
      workspaceId,
      request.nextUrl.searchParams.get("username")
    );

    if (!username) {
      return NextResponse.json({
        username: null,
        profile: null,
        hasData: false,
        configured: false,
        series: [],
        current: null,
        deltas: null,
        engagement: null,
      });
    }

    const days = Math.min(
      730,
      Math.max(7, parseInt(request.nextUrl.searchParams.get("days") || "90", 10) || 90)
    );
    const since = shiftDays(new Date().toISOString().slice(0, 10), -days);

    const [{ data: snapRows }, { data: profileRow }] = await Promise.all([
      admin
        .from("instagram_snapshots")
        .select(
          "captured_on, followers_count, following_count, posts_count, avg_likes, avg_comments, engagement_rate"
        )
        .eq("workspace_id", workspaceId)
        .eq("username", username)
        .gte("captured_on", since)
        .order("captured_on", { ascending: true }),
      admin
        .from("instagram_profiles")
        .select(
          "username, full_name, profile_pic_url, biography, external_url, followers_count, following_count, posts_count, last_scraped_at"
        )
        .eq("workspace_id", workspaceId)
        .eq("username", username)
        .maybeSingle(),
    ]);

    const rows = (snapRows || []) as SnapshotRow[];

    const profile = profileRow
      ? {
          username: profileRow.username,
          fullName: profileRow.full_name,
          profilePicUrl: profileRow.profile_pic_url,
          biography: profileRow.biography,
          externalUrl: profileRow.external_url,
          followersCount: profileRow.followers_count,
          followingCount: profileRow.following_count,
          postsCount: profileRow.posts_count,
          lastScrapedAt: profileRow.last_scraped_at,
        }
      : null;

    if (rows.length === 0) {
      return NextResponse.json({
        username,
        profile,
        hasData: false,
        configured: true,
        series: [],
        current: null,
        deltas: null,
        engagement: null,
      });
    }

    // Monta a série com delta diário (vs ponto anterior disponível).
    const series: SeriesPoint[] = rows.map((r, i) => {
      const prev = i > 0 ? rows[i - 1] : null;
      return {
        date: r.captured_on,
        label: toLabel(r.captured_on),
        followers: r.followers_count,
        following: r.following_count,
        posts: r.posts_count,
        avgLikes: r.avg_likes,
        avgComments: r.avg_comments,
        engagementRate: r.engagement_rate,
        dailyDelta: prev ? r.followers_count - prev.followers_count : null,
      };
    });

    const current = series[series.length - 1];
    const first = series[0];

    const ref30 = refByDaysAgo(series, 30);
    const periodNet = current.followers - first.followers;
    const spanDays = Math.max(1, daysBetween(first.date, current.date));

    const deltas = {
      d1: makeDelta(current.followers, refByDaysAgo(series, 1)?.followers),
      d7: makeDelta(current.followers, refByDaysAgo(series, 7)?.followers),
      d30: makeDelta(current.followers, ref30?.followers),
      periodNet,
      periodPct:
        first.followers > 0
          ? Math.round((periodNet / first.followers) * 10000) / 100
          : null,
      periodDays: spanDays,
      avgDailyGrowth: Math.round(periodNet / spanDays),
    };

    const engagement = {
      current: current.engagementRate,
      ref30d: ref30?.engagementRate ?? null,
      deltaPct:
        current.engagementRate != null &&
        ref30?.engagementRate != null &&
        ref30.engagementRate > 0
          ? Math.round(
              ((current.engagementRate - ref30.engagementRate) / ref30.engagementRate) *
                10000
            ) / 100
          : null,
      avgLikes: current.avgLikes,
      avgComments: current.avgComments,
    };

    return NextResponse.json({
      username,
      profile,
      hasData: true,
      configured: true,
      series,
      current,
      deltas,
      engagement,
    });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
