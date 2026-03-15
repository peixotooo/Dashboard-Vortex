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

function classifyCampaigns(campaigns: CampaignWithMetrics[]): CampaignWithMetrics[] {
  const withSpend = campaigns.filter((c) => c.spend > 0);
  if (withSpend.length < 3) return campaigns;

  const avgRoas = withSpend.reduce((s, c) => s + c.roas, 0) / withSpend.length;
  const avgSpend = withSpend.reduce((s, c) => s + c.spend, 0) / withSpend.length;

  return campaigns.map((c) => {
    if (c.spend <= 0) return { ...c, tier: null };

    const highRoas = c.roas >= avgRoas * 1.5;
    const highSpend = c.spend >= avgSpend;
    const veryHighSpend = c.spend >= avgSpend * 2;

    let tier: CampaignWithMetrics["tier"] = null;
    if (highRoas && highSpend) tier = "champion";
    else if (highRoas) tier = "potential";
    else if (veryHighSpend && c.roas >= 1.0) tier = "scale";
    else if (c.roas >= 1.0) tier = "profitable";
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

      const result = await getCampaignsWithMetrics({
        account_id,
        time_range: timeRange,
        statuses,
      });

      const classified = classifyCampaigns(result.campaigns);

      // Auto-save classified campaigns to DB (fire-and-forget)
      const workspaceId = request.headers.get("x-workspace-id") || "";
      if (workspaceId) {
        const toSave = classified.filter((c) => c.tier === "champion" || c.tier === "potential" || c.tier === "scale");
        if (toSave.length > 0) {
          const supabase = createServerClient(
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
          );
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
