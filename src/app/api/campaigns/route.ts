import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  listCampaigns,
  getCampaignsWithMetrics,
  createCampaign,
  pauseCampaign,
  resumeCampaign,
  deleteCampaign,
  updateCampaign,
} from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";
import { datePresetToTimeRange } from "@/lib/utils";
import { syncSavedCampaigns } from "@/lib/agent/memory";
import type { DatePreset, CampaignWithMetrics } from "@/lib/types";

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

function classifyCampaigns(
  campaigns: CampaignWithMetrics[],
  financialSettings?: FinancialSettings | null
): CampaignWithMetrics[] {
  const withSpend = campaigns.filter((c) => c.spend > 0);
  if (withSpend.length < 3) return campaigns;

  // Calculate financial thresholds
  const fs = financialSettings || FINANCIAL_DEFAULTS;
  const mc = 100 - fs.frete_pct - fs.desconto_pct - fs.tax_pct - fs.product_cost_pct - fs.other_expenses_pct;
  const monthlyRevenue = fs.annual_revenue_target / 12;
  const fixedCostPct = monthlyRevenue > 0 ? (fs.monthly_fixed_costs / monthlyRevenue) * 100 : 0;
  const availableForAds = mc - fixedCostPct;

  const breakevenRoas = availableForAds > 0 ? 100 / availableForAds : 3;
  const healthyRoas = (availableForAds - 8) > 0 ? 100 / (availableForAds - 8) : breakevenRoas * 1.3;

  // Portfolio metrics (for volume classification)
  const avgSpend = withSpend.reduce((s, c) => s + c.spend, 0) / withSpend.length;

  return campaigns.map((c) => {
    if (c.spend <= 0) return { ...c, tier: null };

    const aboveHealthy = c.roas >= healthyRoas;
    const aboveBreakeven = c.roas >= breakevenRoas;
    const highSpend = c.spend >= avgSpend;

    let tier: CampaignWithMetrics["tier"] = null;
    if (aboveHealthy && highSpend) tier = "champion";
    else if (aboveHealthy) tier = "potential";
    else if (aboveBreakeven && highSpend) tier = "scale";
    else if (aboveBreakeven) tier = "profitable";
    else if (c.roas > 0) tier = "warning";
    else tier = "critical";

    return { ...c, tier };
  });
}

export async function GET(request: NextRequest) {
  try {
    await getAuthenticatedContext(request).catch(() => {});

    const { searchParams } = new URL(request.url);
    const account_id = searchParams.get("account_id") || "";

    // If date_preset is present, fetch with metrics + classification
    const date_preset = searchParams.get("date_preset") as DatePreset | null;
    if (date_preset) {
      const statusesParam = searchParams.get("statuses");
      const statuses = statusesParam ? statusesParam.split(",") : ["ACTIVE"];
      const timeRange = datePresetToTimeRange(date_preset);

      const workspaceId = request.headers.get("x-workspace-id") || "";

      // Fetch campaigns + financial settings in parallel
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
        getCampaignsWithMetrics({
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

      const classified = classifyCampaigns(result.campaigns, financialSettings);

      // Auto-save classified campaigns to DB (fire-and-forget)
      if (workspaceId && supabase) {
        const toSave = classified.filter((c) => c.tier === "champion" || c.tier === "potential" || c.tier === "scale");
        if (toSave.length > 0) {
          syncSavedCampaigns(supabase, workspaceId, toSave, date_preset).catch(
            () => {}
          );
        }
      }

      return NextResponse.json({ campaigns: classified });
    }

    // Legacy: simple list without metrics
    const status = searchParams.get("status") || "";
    const limit = parseInt(searchParams.get("limit") || "25");
    const result = await listCampaigns({ account_id, status_filter: status, limit });
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
    switch (action) {
      case "pause":
        result = await pauseCampaign(args);
        break;
      case "resume":
        result = await resumeCampaign(args);
        break;
      case "delete":
        result = await deleteCampaign(args);
        break;
      case "update":
        result = await updateCampaign(args);
        break;
      case "update_budgets": {
        const updates = args.campaign_updates as Array<{ campaign_id: string; daily_budget: number }>;
        const results = [];
        for (const u of updates) {
          try {
            await updateCampaign({ campaign_id: u.campaign_id, daily_budget: String(u.daily_budget) });
            results.push({ id: u.campaign_id, success: true });
          } catch (err) {
            results.push({ id: u.campaign_id, success: false, error: String(err) });
          }
        }
        result = { results };
        break;
      }
      default:
        result = await createCampaign(args);
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleAuthError(error);
  }
}
