import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getWaConfig } from "@/lib/whatsapp-api";
import {
  getPricingAnalytics,
  getTemplateAnalytics,
  getMonthlySpendSummary,
  toTimestamp,
} from "@/lib/wa-analytics";

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll() {},
      },
    }
  );
}

/**
 * GET /api/crm/whatsapp/analytics
 *
 * Query params:
 *   period: "current_month" | "last_month" | "last_3_months" | "custom"
 *   start: ISO date (required if period=custom)
 *   end: ISO date (required if period=custom)
 *   view: "spend" (default) | "templates"
 *   templateIds: comma-separated Meta template IDs (for view=templates)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const config = await getWaConfig(workspaceId);
    if (!config) {
      console.error("[WA Analytics Route] No WA config for workspace", workspaceId);
      return NextResponse.json({ error: "WhatsApp not configured" }, { status: 404 });
    }
    const params = request.nextUrl.searchParams;
    const period = params.get("period") || "current_month";
    console.log("[WA Analytics Route] Config found, wabaId=", config.wabaId, "period=", period);
    const view = params.get("view") || "spend";

    // Template analytics view
    if (view === "templates") {
      const idsParam = params.get("templateIds") || "";
      const templateIds = idsParam
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n));

      const { startTs, endTs } = resolvePeriod(period, params);

      const metrics = await getTemplateAnalytics(config.wabaId, config.accessToken, {
        startTimestamp: startTs,
        endTimestamp: endTs,
        templateIds: templateIds.length > 0 ? templateIds : undefined,
      });

      return NextResponse.json({ metrics }, {
        headers: { "Cache-Control": "private, max-age=300" },
      });
    }

    // Spend view (default)
    if (period === "current_month" || period === "last_month") {
      const now = new Date();
      let year = now.getFullYear();
      let month = now.getMonth() + 1;
      if (period === "last_month") {
        month -= 1;
        if (month === 0) { month = 12; year -= 1; }
      }

      const result = await getMonthlySpendSummary(config.wabaId, config.accessToken, {
        year,
        month,
      });

      return NextResponse.json(result, {
        headers: { "Cache-Control": "private, max-age=300" },
      });
    }

    // Custom or last_3_months
    const { startTs, endTs } = resolvePeriod(period, params);

    const result = await getPricingAnalytics(config.wabaId, config.accessToken, {
      startTimestamp: startTs,
      endTimestamp: endTs,
      granularity: "MONTHLY",
      dimensions: ["PRICING_CATEGORY", "PRICING_TYPE"],
    });

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[WA Analytics]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// --- Helpers ---

function resolvePeriod(
  period: string,
  params: URLSearchParams
): { startTs: number; endTs: number } {
  const now = new Date();

  if (period === "custom") {
    const start = params.get("start");
    const end = params.get("end");
    if (!start || !end) throw new Error("start and end required for custom period");
    return { startTs: toTimestamp(start), endTs: toTimestamp(end) };
  }

  if (period === "last_3_months") {
    const endDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
    const startDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 2, 1));
    return {
      startTs: Math.floor(startDate.getTime() / 1000),
      endTs: Math.floor(endDate.getTime() / 1000),
    };
  }

  if (period === "last_month") {
    const startDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
    const endDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0));
    return {
      startTs: Math.floor(startDate.getTime() / 1000),
      endTs: Math.floor(endDate.getTime() / 1000),
    };
  }

  // current_month (default)
  const startDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  return {
    startTs: Math.floor(startDate.getTime() / 1000),
    endTs: Math.floor(now.getTime() / 1000),
  };
}
