// src/lib/email-templates/hours.ts
import { getGA4Report } from "@/lib/ga4-api";
import type { HoursPick } from "./types";

const FALLBACK: HoursPick = {
  recommended_hours: [9, 14, 20],
  hours_score: { "9": 0, "14": 0, "20": 0 },
};

const MIN_SESSIONS_PER_HOUR = 30; // significance threshold

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function pickTopHours(
  // workspace_id reserved for future per-tenant GA4 configs
  _workspace_id: string,
  lookback_days = 14
): Promise<HoursPick> {
  const endDate = isoDate(new Date());
  const startDate = isoDate(new Date(Date.now() - lookback_days * 24 * 60 * 60 * 1000));

  let rows: Array<{ hour: number; sessions: number; conversions: number }> = [];
  try {
    const report = await getGA4Report({
      startDate,
      endDate,
      dimensions: ["hour"],
      metrics: ["sessions", "conversions"],
      limit: 24 * lookback_days,
    });
    rows = (report?.rows ?? []).map((r) => {
      const h = parseInt(r.dimensions?.hour ?? "", 10);
      return {
        hour: Number.isFinite(h) ? h : -1,
        sessions: Number(r.metrics?.sessions ?? 0),
        conversions: Number(r.metrics?.conversions ?? 0),
      };
    }).filter((r) => r.hour >= 0 && r.hour <= 23);
  } catch {
    return FALLBACK;
  }
  if (rows.length === 0) return FALLBACK;

  // Aggregate by hour-of-day (rows already by hour but defensively sum across days)
  const buckets: Record<number, { s: number; c: number }> = {};
  for (let h = 0; h < 24; h++) buckets[h] = { s: 0, c: 0 };
  for (const r of rows) {
    buckets[r.hour].s += r.sessions;
    buckets[r.hour].c += r.conversions;
  }

  const scored = Object.entries(buckets).map(([h, v]) => {
    const conv_rate = v.s > 0 ? v.c / v.s : 0;
    const significance = v.s >= MIN_SESSIONS_PER_HOUR ? 1 : 0.85;
    return { hour: parseInt(h, 10), score: conv_rate * significance, sessions: v.s };
  });

  // Sort desc by score (sessions as tiebreaker)
  scored.sort((a, b) => b.score - a.score || b.sessions - a.sessions);

  // Pick top 3 with dispersion (≥3h gap)
  const picks: number[] = [];
  for (const s of scored) {
    if (picks.length >= 3) break;
    if (picks.every((p) => Math.abs(p - s.hour) >= 3)) {
      picks.push(s.hour);
    }
  }

  if (picks.length < 3) return FALLBACK;

  picks.sort((a, b) => a - b);
  const score: Record<string, number> = {};
  for (const h of picks) {
    const found = scored.find((s) => s.hour === h);
    score[String(h)] = Number((found?.score ?? 0).toFixed(4));
  }
  return { recommended_hours: picks, hours_score: score };
}
