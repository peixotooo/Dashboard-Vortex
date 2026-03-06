import { NextRequest, NextResponse } from "next/server";
import { getActiveAdsWithCreatives, getCreativeDetails, createAdCreative } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";
import { datePresetToTimeRange } from "@/lib/utils";
import type { DatePreset } from "@/lib/types";

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

    return NextResponse.json(result);
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
