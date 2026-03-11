import { NextRequest, NextResponse } from "next/server";
import { getInsights, comparePerformance } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";
import { datePresetToTimeRange, getPreviousPeriodDates } from "@/lib/utils";
import type { DatePreset } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const { searchParams } = new URL(request.url);
    const object_id = searchParams.get("object_id") || "";
    const level = searchParams.get("level") || "account";
    const date_preset = (searchParams.get("date_preset") || "last_30d") as DatePreset;
    const sinceParam = searchParams.get("since") || "";
    const untilParam = searchParams.get("until") || "";
    const customRange = sinceParam && untilParam ? { since: sinceParam, until: untilParam } : undefined;
    const breakdowns = searchParams.get("breakdowns") || "";
    const fields = searchParams.get("fields") || "";
    const include_comparison = searchParams.get("include_comparison") === "true";

    const timeRange = datePresetToTimeRange(date_preset, customRange);
    const result = await getInsights({
      object_id,
      level,
      time_range: timeRange,
      breakdowns: breakdowns ? breakdowns.split(",") : undefined,
      fields: fields ? fields.split(",") : undefined,
    });

    if (include_comparison) {
      const prevDates = getPreviousPeriodDates(date_preset, customRange);
      const prevResult = await getInsights({
        object_id,
        level,
        time_range: prevDates,
        time_increment: "all_days",
        fields: fields ? fields.split(",") : undefined,
      }) as { insights: Array<Record<string, string>> };

      const prevInsights = prevResult.insights || [];
      let prevSpend = 0, prevImpressions = 0, prevClicks = 0, prevReach = 0;
      let prevRevenue = 0, prevPurchases = 0;

      prevInsights.forEach((row: Record<string, unknown>) => {
        prevSpend += parseFloat((row.spend as string) || "0");
        prevImpressions += parseFloat((row.impressions as string) || "0");
        prevClicks += parseFloat((row.clicks as string) || "0");
        prevReach += parseFloat((row.reach as string) || "0");

        const actions = row.actions as Array<{ action_type: string; value: string }> | undefined;
        const actionValues = row.action_values as Array<{ action_type: string; value: string }> | undefined;
        if (actions) {
          const purchase = actions.find((a) => a.action_type === "purchase");
          if (purchase) prevPurchases += parseFloat(purchase.value || "0");
        }
        if (actionValues) {
          const purchaseVal = actionValues.find((a) => a.action_type === "purchase");
          if (purchaseVal) prevRevenue += parseFloat(purchaseVal.value || "0");
        }
      });

      const prevCtr = prevImpressions > 0 ? (prevClicks / prevImpressions) * 100 : 0;
      const prevCpc = prevClicks > 0 ? prevSpend / prevClicks : 0;
      const prevRoas = prevSpend > 0 ? prevRevenue / prevSpend : 0;

      return NextResponse.json({
        ...(result as Record<string, unknown>),
        comparison: {
          spend: prevSpend,
          impressions: prevImpressions,
          clicks: prevClicks,
          reach: prevReach,
          ctr: prevCtr,
          cpc: prevCpc,
          revenue: prevRevenue,
          purchases: prevPurchases,
          roas: prevRoas,
        },
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const body = await request.json();
    const { action, ...args } = body;

    let result;
    if (action === "compare") {
      result = await comparePerformance(args);
    } else {
      result = await getInsights(args);
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}
