import { NextRequest, NextResponse } from "next/server";
import { getGA4DailyReport } from "@/lib/ga4-api";
import { getPreviousPeriodDates } from "@/lib/utils";
import type { DatePreset } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("property_id") || undefined;
    const datePreset = (searchParams.get("date_preset") || "last_30d") as DatePreset;
    const includeComparison = searchParams.get("include_comparison") === "true";

    // Check if GA4 is configured
    if (!process.env.GA4_PROPERTY_ID && !propertyId) {
      return NextResponse.json({
        insights: [],
        totals: { sessions: 0, users: 0, newUsers: 0, transactions: 0, revenue: 0, pageViews: 0 },
        configured: false,
      });
    }

    const result = await getGA4DailyReport({
      propertyId,
      datePreset,
    });

    if (includeComparison) {
      const prevDates = getPreviousPeriodDates(datePreset);
      const prevResult = await getGA4DailyReport({
        propertyId,
        startDate: prevDates.since,
        endDate: prevDates.until,
      });

      return NextResponse.json({
        ...result,
        configured: true,
        comparison: prevResult.totals,
      });
    }

    return NextResponse.json({ ...result, configured: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // If GA4 is not configured, return empty data gracefully
    if (message.includes("not configured") || message.includes("GOOGLE_APPLICATION_CREDENTIALS")) {
      return NextResponse.json({
        insights: [],
        totals: { sessions: 0, users: 0, newUsers: 0, transactions: 0, revenue: 0, pageViews: 0 },
        configured: false,
      });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
