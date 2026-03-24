import { NextRequest, NextResponse } from "next/server";
import {
  getAccountActivities,
  setContextToken,
  type MetaActivity,
} from "@/lib/meta-api";
import type { ActivityEntry, ActivitySource } from "@/lib/types";

const PERIOD_MS: Record<string, number> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

function classifySource(
  activity: MetaActivity,
  dashboardAppId?: string
): ActivitySource {
  const appId = activity.application_id || "";
  const appName = (activity.application_name || "").toLowerCase();

  if (dashboardAppId && appId === dashboardAppId) return "dashboard";

  if (appName.includes("ads manager") || appName.includes("facebook ads"))
    return "ads-manager";
  if (appName.includes("business suite") || appName.includes("meta business"))
    return "business-suite";

  if (!appId && !appName) return "other";
  return "other";
}

function parseExtraData(raw?: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw_data: raw };
  }
}

function buildChangeDescription(
  activity: MetaActivity,
  extra: Record<string, unknown> | undefined
): { description: string; oldValue?: string; newValue?: string } {
  if (activity.translated_event_type) {
    return {
      description: activity.translated_event_type,
      oldValue: extra?.old_value != null ? String(extra.old_value) : undefined,
      newValue: extra?.new_value != null ? String(extra.new_value) : undefined,
    };
  }

  const humanized = (activity.event_type || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

  return {
    description: humanized,
    oldValue: extra?.old_value != null ? String(extra.old_value) : undefined,
    newValue: extra?.new_value != null ? String(extra.new_value) : undefined,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("account_id");
    if (!accountId) {
      return NextResponse.json(
        { error: "account_id is required" },
        { status: 400 }
      );
    }

    const metaToken = process.env.META_ACCESS_TOKEN;
    if (!metaToken) {
      return NextResponse.json(
        { error: "META_ACCESS_TOKEN not configured" },
        { status: 500 }
      );
    }
    setContextToken(metaToken);

    let since: number | undefined;
    let until: number | undefined;

    const sinceParam = searchParams.get("since");
    const untilParam = searchParams.get("until");
    const period = searchParams.get("period") || "7d";

    if (sinceParam) {
      since = parseInt(sinceParam, 10);
    } else {
      const ms = PERIOD_MS[period] || PERIOD_MS["7d"];
      since = Math.floor((Date.now() - ms) / 1000);
    }
    if (untilParam) {
      until = parseInt(untilParam, 10);
    }

    const category = searchParams.get("category") || undefined;
    const dashboardAppId = process.env.META_APP_ID || "";

    const { activities: rawActivities } = await getAccountActivities({
      account_id: accountId,
      since,
      until,
      category,
    });

    const enriched: ActivityEntry[] = rawActivities.map((a) => {
      const extra = parseExtraData(a.extra_data);
      const { description, oldValue, newValue } = buildChangeDescription(
        a,
        extra
      );

      return {
        event_time: a.event_time,
        actor_name: a.actor_name,
        application_name: a.application_name,
        event_type: a.event_type,
        translated_event_type: a.translated_event_type,
        object_id: a.object_id,
        object_name: a.object_name,
        object_type: a.object_type,
        extra_data: extra,
        date_time_in_timezone: a.date_time_in_timezone,
        source: classifySource(a, dashboardAppId),
        change_description: description,
        old_value: oldValue,
        new_value: newValue,
      };
    });

    return NextResponse.json({
      activities: enriched,
      total: enriched.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
