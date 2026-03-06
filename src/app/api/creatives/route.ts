import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getActiveAdsWithCreatives, getCreativeDetails, createAdCreative } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";
import { datePresetToTimeRange } from "@/lib/utils";
import { syncSavedCreatives } from "@/lib/agent/memory";
import type { DatePreset, ActiveAdCreative } from "@/lib/types";

function classifyCreatives(ads: ActiveAdCreative[]): ActiveAdCreative[] {
  const withSpend = ads.filter((a) => a.spend > 0);
  if (withSpend.length < 3) return ads;

  const avgRoas = withSpend.reduce((s, a) => s + a.roas, 0) / withSpend.length;
  const avgSpend = withSpend.reduce((s, a) => s + a.spend, 0) / withSpend.length;

  return ads.map((ad) => {
    if (ad.spend <= 0) return { ...ad, tier: null };

    const highRoas = ad.roas >= avgRoas * 1.5;
    const highSpend = ad.spend >= avgSpend;
    const veryHighSpend = ad.spend >= avgSpend * 2;

    let tier: "champion" | "potential" | "scale" | null = null;
    if (highRoas && highSpend) tier = "champion";
    else if (highRoas) tier = "potential";
    else if (veryHighSpend && ad.roas >= 1.0) tier = "scale";

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
    const result = await getActiveAdsWithCreatives({
      account_id,
      time_range: timeRange,
      statuses,
    });

    // Classify creatives into tiers
    const classifiedAds = classifyCreatives(result.ads || []);

    // Auto-save classified creatives to DB (fire-and-forget)
    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (workspaceId) {
      const classified = classifiedAds.filter((a) => a.tier);
      if (classified.length > 0) {
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
