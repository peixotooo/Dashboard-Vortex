import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getActiveAdsWithCreatives, getCreativeDetails, createAdCreative } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";
import { datePresetToTimeRange } from "@/lib/utils";
import { syncSavedCreatives } from "@/lib/agent/memory";
import type { DatePreset, ActiveAdCreative } from "@/lib/types";

const FINANCIAL_DEFAULTS = {
  frete_pct: 6,
  desconto_pct: 3,
  tax_pct: 6,
  product_cost_pct: 25,
  other_expenses_pct: 5,
  monthly_fixed_costs: 160000,
  annual_revenue_target: 8000000,
};

interface FinancialSettings {
  frete_pct: number;
  desconto_pct: number;
  tax_pct: number;
  product_cost_pct: number;
  other_expenses_pct: number;
  monthly_fixed_costs: number;
  annual_revenue_target: number;
}

function classifyCreatives(
  ads: ActiveAdCreative[],
  financialSettings?: FinancialSettings | null
): ActiveAdCreative[] {
  const withSpend = ads.filter((a) => a.spend > 0);
  if (withSpend.length < 3) return ads;

  // Calculate financial thresholds
  const fs = financialSettings || FINANCIAL_DEFAULTS;
  const mc = 100 - fs.frete_pct - fs.desconto_pct - fs.tax_pct - fs.product_cost_pct - fs.other_expenses_pct;
  const monthlyRevenue = fs.annual_revenue_target / 12;
  const fixedCostPct = monthlyRevenue > 0 ? (fs.monthly_fixed_costs / monthlyRevenue) * 100 : 0;
  const availableForAds = mc - fixedCostPct;

  const breakevenRoas = availableForAds > 0 ? 100 / availableForAds : 3;
  const healthyRoas = (availableForAds - 8) > 0 ? 100 / (availableForAds - 8) : breakevenRoas * 1.3;

  // Portfolio metrics (for volume classification)
  const avgSpend = withSpend.reduce((s, a) => s + a.spend, 0) / withSpend.length;

  return ads.map((ad) => {
    if (ad.spend <= 0) return { ...ad, tier: null };

    const aboveHealthy = ad.roas >= healthyRoas;
    const aboveBreakeven = ad.roas >= breakevenRoas;
    const highSpend = ad.spend >= avgSpend;

    let tier: ActiveAdCreative["tier"] = null;
    if (aboveHealthy && highSpend) tier = "champion";
    else if (aboveHealthy) tier = "potential";
    else if (aboveBreakeven && highSpend) tier = "scale";
    else if (aboveBreakeven) tier = "profitable";
    else if (ad.roas > 0) tier = "warning";
    else tier = "critical";

    return { ...ad, tier };
  });
}

export async function GET(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const { searchParams } = new URL(request.url);
    const account_id = searchParams.get("account_id") || "";
    const date_preset = (searchParams.get("date_preset") || "last_30d") as DatePreset;
    const statusesParam = searchParams.get("statuses");
    const statuses = statusesParam ? statusesParam.split(",") : ["ACTIVE"];

    const timeRange = datePresetToTimeRange(date_preset);
    const workspaceId = request.headers.get("x-workspace-id") || "";

    const supabase = workspaceId
      ? createServerClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            cookies: {
              getAll() {
                return request.cookies.getAll();
              },
              setAll() {},
            },
          }
        )
      : null;

    const [result, financialSettings] = await Promise.all([
      getActiveAdsWithCreatives({
        account_id,
        time_range: timeRange,
        statuses,
      }),
      workspaceId && supabase
        ? supabase
            .from("workspace_financial_settings")
            .select("frete_pct,desconto_pct,tax_pct,product_cost_pct,other_expenses_pct,monthly_fixed_costs,annual_revenue_target")
            .eq("workspace_id", workspaceId)
            .maybeSingle()
            .then(({ data }) => data as FinancialSettings | null)
        : Promise.resolve(null),
    ]);

    // Classify creatives into tiers using financial thresholds
    const classifiedAds = classifyCreatives(result.ads || [], financialSettings);

    // Auto-save classified creatives to DB (fire-and-forget)
    if (workspaceId && supabase) {
      const classified = classifiedAds.filter((a) => a.tier === "champion" || a.tier === "potential" || a.tier === "scale");
      if (classified.length > 0) {
        syncSavedCreatives(supabase, workspaceId, classified, date_preset).catch(
          () => {}
        );
      }
    }

    return NextResponse.json({ ads: classifiedAds });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const body = await request.json();

    if (body.action === "details" && body.creative_id) {
      const result = await getCreativeDetails({
        creative_id: body.creative_id,
        account_id: body.account_id,
      });
      return NextResponse.json(result);
    }

    if (body.action === "create" || Object.keys(body).length > 2) {
      const result = await createAdCreative(body);
      return NextResponse.json(result);
    }

    return NextResponse.json({ ads: [] });
  } catch (error) {
    return handleAuthError(error);
  }
}
