import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getGoogleAdsCampaigns } from "@/lib/google-ads-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";
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
    const date_preset = (searchParams.get("date_preset") || "last_30d") as DatePreset;
    const customerId = searchParams.get("customer_id") || undefined;

    const result = await getGoogleAdsCampaigns({
      datePreset: date_preset,
      statuses: ["ACTIVE", "PAUSED"],
      customerId,
    });

    const classified = classifyCampaigns(result.campaigns);

    // Auto-save classified campaigns to DB (fire-and-forget)
    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (workspaceId) {
      const toSave = classified.filter(
        (c) => c.tier === "champion" || c.tier === "potential" || c.tier === "scale"
      );
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
        syncSavedCampaigns(supabase, workspaceId, toSave, date_preset, "google").catch(
          () => {}
        );
      }
    }

    return NextResponse.json({ campaigns: classified });
  } catch (error) {
    return handleAuthError(error);
  }
}
