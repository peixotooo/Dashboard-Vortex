import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { fetchAllSupabasePages } from "@/lib/reviews/pagination";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type ReviewMetricRow = {
  rating: number | string | null;
  status: string | null;
  source: string | null;
  media_kind: string | null;
  reward_status: string | null;
  reward_amount: number | string | null;
  ads_status: string | null;
};

type ReviewRequestMetricRow = {
  status: string | null;
};

type StoreReviewMetricRow = {
  rating: number | string | null;
  status: string | null;
};

// NPS estimado a partir das notas (1-5): 5 = promotor, 4 = neutro, ≤3 = detrator.
function npsFromRatings(ratings: number[]): { nps: number; promoters: number; passives: number; detractors: number } {
  let promoters = 0, passives = 0, detractors = 0;
  for (const r of ratings) {
    if (r >= 5) promoters++;
    else if (r === 4) passives++;
    else detractors++;
  }
  const total = ratings.length || 1;
  return { nps: Math.round(((promoters - detractors) / total) * 100), promoters, passives, detractors };
}

function dist(ratings: number[]): Record<number, number> {
  const d: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of ratings) if (r >= 1 && r <= 5) d[r]++;
  return d;
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const admin = createAdminClient();

    // --- Avaliações de produto ---
    const reviews = await fetchAllSupabasePages<ReviewMetricRow>(async (from, to) => {
      const { data, error } = await admin
        .from("reviews")
        .select("rating, status, source, media_kind, reward_status, reward_amount, ads_status")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);

      return { data: data as ReviewMetricRow[] | null, error };
    });
    const pub = reviews.filter((r) => r.status === "published");
    const pubRatings = pub.map((r) => Number(r.rating)).filter((n) => n >= 1 && n <= 5);
    const avg = pubRatings.length ? Number((pubRatings.reduce((a, b) => a + b, 0) / pubRatings.length).toFixed(2)) : 0;

    const byStatus: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    let withPhoto = 0, withVideo = 0;
    let rewardCount = 0, rewardTotal = 0, adsPending = 0, adsAccepted = 0;
    for (const r of reviews) {
      const status = r.status || "unknown";
      const source = r.source || "unknown";
      byStatus[status] = (byStatus[status] || 0) + 1;
      bySource[source] = (bySource[source] || 0) + 1;
      if (r.media_kind === "photo") withPhoto++;
      if (r.media_kind === "video") withVideo++;
      if (r.reward_status === "granted") { rewardCount++; rewardTotal += Number(r.reward_amount) || 0; }
      if (r.ads_status === "pending") adsPending++;
      if (r.ads_status === "accepted") adsAccepted++;
    }

    // --- Funil da régua ---
    const reqs = await fetchAllSupabasePages<ReviewRequestMetricRow>(async (from, to) => {
      const { data, error } = await admin
        .from("review_requests")
        .select("status")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);

      return { data: data as ReviewRequestMetricRow[] | null, error };
    });
    const reqStatus: Record<string, number> = {};
    for (const r of reqs) {
      const status = r.status || "unknown";
      reqStatus[status] = (reqStatus[status] || 0) + 1;
    }
    const created = reqs.length;
    const contacted = (reqStatus["sent"] || 0) + (reqStatus["reminded"] || 0) + (reqStatus["completed"] || 0);
    const completed = reqStatus["completed"] || 0;
    const conversion = contacted ? Number(((completed / contacted) * 100).toFixed(1)) : 0;

    // --- Avaliações da loja ---
    const store = await fetchAllSupabasePages<StoreReviewMetricRow>(async (from, to) => {
      const { data, error } = await admin
        .from("store_reviews")
        .select("rating, status")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);

      return { data: data as StoreReviewMetricRow[] | null, error };
    });
    const storePub = store.filter((s) => s.status === "published");
    const storeRatings = storePub.map((s) => Number(s.rating)).filter((n) => n >= 1 && n <= 5);
    const storeAvg = storeRatings.length ? Number((storeRatings.reduce((a, b) => a + b, 0) / storeRatings.length).toFixed(2)) : 0;

    return NextResponse.json({
      product: {
        total: reviews.length,
        published: pub.length,
        pending: byStatus["pending"] || 0,
        average: avg,
        distribution: dist(pubRatings),
        nps: npsFromRatings(pubRatings),
        by_source: bySource,
      },
      funnel: {
        created,
        contacted,
        completed,
        conversion_rate: conversion,
        by_status: reqStatus,
      },
      store: {
        total: store.length,
        published: storePub.length,
        average: storeAvg,
        distribution: dist(storeRatings),
        nps: npsFromRatings(storeRatings),
      },
      rewards: { granted_count: rewardCount, total_amount: Number(rewardTotal.toFixed(2)), ads_pending: adsPending, ads_accepted: adsAccepted },
      media: { with_photo: withPhoto, with_video: withVideo, pct_with_media: reviews.length ? Number((((withPhoto + withVideo) / reviews.length) * 100).toFixed(0)) : 0 },
    });
  } catch (e) {
    return handleAuthError(e);
  }
}
