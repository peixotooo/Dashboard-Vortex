import { NextRequest, NextResponse } from "next/server";
import { getGA4Report } from "@/lib/ga4-api";
import { getAuthenticatedContext, AuthError, handleAuthError } from "@/lib/api-auth";
import type { DatePreset } from "@/lib/types";

const REPORT_CONFIGS: Record<string, { dimensions: string[]; metrics: string[]; orderBy?: { metric: string; desc: boolean } }> = {
  products: {
    dimensions: ["itemName"],
    metrics: ["itemsPurchased", "itemRevenue", "itemsViewed", "itemsAddedToCart"],
    orderBy: { metric: "itemRevenue", desc: true },
  },
  regions: {
    dimensions: ["region"],
    metrics: ["sessions", "totalUsers", "transactions", "purchaseRevenue"],
    orderBy: { metric: "sessions", desc: true },
  },
  cities: {
    dimensions: ["city"],
    metrics: ["sessions", "totalUsers", "transactions", "purchaseRevenue"],
    orderBy: { metric: "sessions", desc: true },
  },
  hourly: {
    dimensions: ["hour"],
    metrics: ["sessions", "totalUsers", "transactions", "purchaseRevenue"],
    orderBy: { metric: "hour", desc: false },
  },
  day_of_week: {
    dimensions: ["dayOfWeek"],
    metrics: ["sessions", "totalUsers", "transactions", "purchaseRevenue"],
    orderBy: { metric: "dayOfWeek", desc: false },
  },
  best_hours_heatmap: {
    dimensions: ["dayOfWeek", "hour"],
    metrics: ["sessions", "totalUsers", "transactions", "purchaseRevenue"],
    orderBy: { metric: "dayOfWeek", desc: false },
  },
  traffic: {
    dimensions: ["sessionSource", "sessionMedium"],
    metrics: ["sessions", "totalUsers", "transactions", "purchaseRevenue", "bounceRate"],
    orderBy: { metric: "sessions", desc: true },
  },
  devices: {
    dimensions: ["deviceCategory"],
    metrics: ["sessions", "totalUsers", "transactions", "purchaseRevenue", "bounceRate"],
    orderBy: { metric: "sessions", desc: true },
  },
  pages: {
    dimensions: ["pagePath"],
    metrics: ["screenPageViews", "sessions", "bounceRate"],
    orderBy: { metric: "screenPageViews", desc: true },
  },
  google_ads_campaigns: {
    dimensions: ["sessionGoogleAdsCampaignName"],
    metrics: ["advertiserAdCost", "advertiserAdClicks", "advertiserAdImpressions", "sessions", "transactions", "purchaseRevenue"],
    orderBy: { metric: "advertiserAdCost", desc: true },
  },
};

export async function GET(request: NextRequest) {
  try {
    await getAuthenticatedContext(request);

    const { searchParams } = new URL(request.url);
    const reportType = searchParams.get("report_type") || "";
    const datePreset = (searchParams.get("date_preset") || "last_30d") as DatePreset;
    const startDate = searchParams.get("start_date") || undefined;
    const endDate = searchParams.get("end_date") || undefined;
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    if (!process.env.GA4_PROPERTY_ID) {
      return NextResponse.json({ rows: [], configured: false });
    }

    const config = REPORT_CONFIGS[reportType];
    if (!config) {
      return NextResponse.json(
        { error: `Invalid report_type. Valid: ${Object.keys(REPORT_CONFIGS).join(", ")}` },
        { status: 400 }
      );
    }

    // For hourly/day_of_week/heatmap, ordering is by dimension not metric
    let orderBy = config.orderBy;
    if (
      reportType === "hourly" ||
      reportType === "day_of_week" ||
      reportType === "best_hours_heatmap"
    ) {
      orderBy = undefined; // GA4 sorts dimensions differently
    }

    const result = await getGA4Report({
      ...(startDate && endDate ? { startDate, endDate } : { datePreset }),
      dimensions: config.dimensions,
      metrics: config.metrics,
      limit,
      orderBy,
    });

    return NextResponse.json({ ...result, configured: true });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[GA4 Report] Error:", message);
    return NextResponse.json({ rows: [], configured: false, error: message });
  }
}
