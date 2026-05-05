// src/app/api/crm/email-templates/reports/[id]/route.ts
//
// Per-dispatch deep stats: pulls overview + bounces + clicks + opens fresh
// from Locaweb (so the user always sees current data even between cron
// ticks), and attributes revenue via GA4 using the dispatch's utm_campaign
// + utm_id stored in email_template_dispatches.stats.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { getLocawebSettings } from "@/lib/locaweb/settings";
import {
  getMessage,
  getMessageOverview,
  getMessageBounces,
  getMessageClicks,
  getMessageUniqOpenings,
} from "@/lib/locaweb/email-marketing";
import { getGA4Report } from "@/lib/ga4-api";

export const runtime = "nodejs";
export const maxDuration = 60;

interface DispatchRow {
  id: string;
  workspace_id: string;
  locaweb_message_id: string;
  status: string;
  stats: Record<string, unknown>;
  created_at: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    const sb = createAdminClient();

    const { data, error } = await sb
      .from("email_template_dispatches")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    const dispatch = data as DispatchRow;

    const settings = await getLocawebSettings(workspaceId);
    let locaweb: Record<string, unknown> = {};
    if (settings.account_id && settings.token) {
      const creds = {
        base_url: settings.base_url,
        account_id: settings.account_id,
        token: settings.token,
      };
      const [msg, overview, bounces, clicks, opens] = await Promise.all([
        getMessage(creds, dispatch.locaweb_message_id).catch((err) => ({
          _error: (err as Error).message,
        })),
        getMessageOverview(creds, dispatch.locaweb_message_id).catch(() => ({})),
        getMessageBounces(creds, dispatch.locaweb_message_id).catch(() => []),
        getMessageClicks(creds, dispatch.locaweb_message_id).catch(() => []),
        getMessageUniqOpenings(creds, dispatch.locaweb_message_id).catch(() => []),
      ]);
      locaweb = { message: msg, overview, bounces, clicks, opens };
    }

    // GA4 revenue attribution. campaign + id are stamped on every UTM via
    // tracking.ts — we filter sessions by sessionCampaignName matching the
    // dispatch's utm_campaign over a 30-day window starting from dispatch
    // creation.
    const utmCampaign =
      typeof dispatch.stats?.utm_campaign === "string"
        ? (dispatch.stats.utm_campaign as string)
        : null;
    let ga4: Record<string, unknown> = {};
    if (utmCampaign) {
      const startDate = dispatch.created_at.slice(0, 10);
      const endDate = new Date().toISOString().slice(0, 10);
      try {
        const [sessionsReport, revenueReport] = await Promise.all([
          getGA4Report({
            startDate,
            endDate,
            dimensions: ["sessionCampaignName"],
            metrics: ["sessions", "totalUsers", "engagementRate"],
            limit: 200,
          }),
          getGA4Report({
            startDate,
            endDate,
            dimensions: ["sessionCampaignName"],
            metrics: ["purchaseRevenue", "transactions", "itemsPurchased"],
            limit: 200,
          }),
        ]);
        const sessRow = (sessionsReport?.rows ?? []).find(
          (r) => r.dimensions?.sessionCampaignName === utmCampaign
        );
        const revRow = (revenueReport?.rows ?? []).find(
          (r) => r.dimensions?.sessionCampaignName === utmCampaign
        );
        ga4 = {
          campaign: utmCampaign,
          sessions: Number(sessRow?.metrics?.sessions ?? 0),
          users: Number(sessRow?.metrics?.totalUsers ?? 0),
          engagement_rate: Number(sessRow?.metrics?.engagementRate ?? 0),
          revenue: Number(revRow?.metrics?.purchaseRevenue ?? 0),
          transactions: Number(revRow?.metrics?.transactions ?? 0),
          items: Number(revRow?.metrics?.itemsPurchased ?? 0),
        };
      } catch (err) {
        ga4 = { error: `GA4: ${(err as Error).message}` };
      }
    }

    return NextResponse.json({ dispatch, locaweb, ga4 });
  } catch (err) {
    return handleAuthError(err);
  }
}
