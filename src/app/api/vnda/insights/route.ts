import { NextRequest, NextResponse } from "next/server";
import { getVndaConfig, getVndaDailyReport } from "@/lib/vnda-api";
import { getPreviousPeriodDates } from "@/lib/utils";
import type { DatePreset } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const datePreset = (searchParams.get("date_preset") || "last_30d") as DatePreset;
    const includeComparison = searchParams.get("include_comparison") === "true";
    const workspaceId = request.headers.get("x-workspace-id") || "";

    const config = await getVndaConfig(workspaceId);
    if (!config) {
      return NextResponse.json({
        insights: [],
        totals: { orders: 0, revenue: 0, subtotal: 0, discount: 0, shipping: 0, avgTicket: 0, productsSold: 0 },
        configured: false,
      });
    }

    const result = await getVndaDailyReport({ config, datePreset });

    let comparison = null;
    if (includeComparison) {
      const prevDates = getPreviousPeriodDates(datePreset);
      const prevResult = await getVndaDailyReport({
        config,
        startDate: prevDates.since,
        endDate: prevDates.until,
      });
      comparison = prevResult.totals;
    }

    return NextResponse.json({
      ...result,
      comparison,
      configured: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[VNDA Insights] Error:", message);
    return NextResponse.json({
      insights: [],
      totals: { orders: 0, revenue: 0, subtotal: 0, discount: 0, shipping: 0, avgTicket: 0, productsSold: 0 },
      configured: false,
      error: message,
    });
  }
}
