import { NextRequest, NextResponse } from "next/server";
import { getGA4DailyReport, getGA4GoogleAdsCost } from "@/lib/ga4-api";
import { getPreviousPeriodDates } from "@/lib/utils";
import type { DatePreset } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("property_id") || undefined;
    const datePreset = (searchParams.get("date_preset") || "last_30d") as DatePreset;
    const includeComparison = searchParams.get("include_comparison") === "true";
    const startDate = searchParams.get("start_date") || searchParams.get("since") || undefined;
    const endDate = searchParams.get("end_date") || searchParams.get("until") || undefined;
    const useCustomRange = !!(startDate && endDate);
    const customRange = useCustomRange ? { since: startDate!, until: endDate! } : undefined;

    // Check if GA4 is configured
    if (!process.env.GA4_PROPERTY_ID && !propertyId) {
      return NextResponse.json({
        insights: [],
        totals: { sessions: 0, users: 0, newUsers: 0, transactions: 0, revenue: 0, pageViews: 0 },
        googleAds: null,
        configured: false,
      });
    }

    // Build date args — custom range takes precedence over preset
    const dateArgs = useCustomRange
      ? { startDate, endDate }
      : { datePreset };

    // Fetch GA4 daily report + Google Ads cost in parallel
    const [result, googleAdsResult] = await Promise.all([
      getGA4DailyReport({ propertyId, ...dateArgs }),
      getGA4GoogleAdsCost({ propertyId, ...dateArgs }).catch(() => null),
    ]);

    // Comparison: custom range gets previous period based on duration
    if (includeComparison && (!useCustomRange || datePreset === "custom")) {
      const prevDates = getPreviousPeriodDates(datePreset, customRange);
      const [prevResult, prevGoogleAds] = await Promise.all([
        getGA4DailyReport({
          propertyId,
          startDate: prevDates.since,
          endDate: prevDates.until,
        }),
        getGA4GoogleAdsCost({
          propertyId,
          startDate: prevDates.since,
          endDate: prevDates.until,
        }).catch(() => null),
      ]);

      return NextResponse.json({
        ...result,
        googleAds: googleAdsResult,
        configured: true,
        comparison: prevResult.totals,
        googleAdsComparison: prevGoogleAds?.totals || null,
      });
    }

    return NextResponse.json({
      ...result,
      googleAds: googleAdsResult,
      configured: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[GA4] Error:", message);
    return NextResponse.json({
      insights: [],
      totals: { sessions: 0, users: 0, newUsers: 0, transactions: 0, revenue: 0, pageViews: 0 },
      googleAds: null,
      configured: false,
      error: message,
    });
  }
}
