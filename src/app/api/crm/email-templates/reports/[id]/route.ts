// src/app/api/crm/email-templates/reports/[id]/route.ts
//
// Stats deep do dispatch. Ramifica pelo provider:
//   - Locaweb: pull overview/bounces/clicks/opens fresh da API deles
//   - iPORTO: usa o que está em dispatches.stats (alimentado pelo webhook)
//     + agrega a tabela email_template_iporto_envios por status pra dar
//     o funil per-recipient
//
// Em ambos os casos: GA4 revenue attribution pelo utm_campaign + utm_id.

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
  provider: string | null;
  locaweb_message_id: string | null;
  locaweb_list_ids: string[] | null;
  iporto_message_ids: string[] | null;
  recipients_total: number | null;
  recipients_sent: number | null;
  recipients_failed: number | null;
  subject: string | null;
  from_email: string | null;
  from_name: string | null;
  html_body: string | null;
  scheduled_to: string | null;
  status: string;
  stats: Record<string, unknown> | null;
  last_synced_at: string | null;
  created_at: string;
  draft_id: string | null;
  suggestion_id: string | null;
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
    const provider = dispatch.provider ?? "locaweb";

    // Provider-specific stats
    let locaweb: Record<string, unknown> = {};
    let iporto: Record<string, unknown> = {};
    if (provider === "locaweb" && dispatch.locaweb_message_id) {
      const settings = await getLocawebSettings(workspaceId);
      if (settings.account_id && settings.token) {
        const creds = {
          base_url: settings.base_url,
          account_id: settings.account_id,
          token: settings.token,
        };
        const mid = dispatch.locaweb_message_id;
        const [msg, overview, bounces, clicks, opens] = await Promise.all([
          getMessage(creds, mid).catch((err) => ({
            _error: (err as Error).message,
          })),
          getMessageOverview(creds, mid).catch(() => ({})),
          getMessageBounces(creds, mid).catch(() => []),
          getMessageClicks(creds, mid).catch(() => []),
          getMessageUniqOpenings(creds, mid).catch(() => []),
        ]);
        locaweb = { message: msg, overview, bounces, clicks, opens };
      }
    } else if (provider === "iporto") {
      // Agrega envios por status pro funil per-recipient.
      const { data: statusRows } = await sb
        .from("email_template_iporto_envios")
        .select("status")
        .eq("dispatch_id", id);
      const counts = {
        pending: 0,
        processing: 0,
        sent: 0,
        failed: 0,
      } as Record<string, number>;
      for (const r of (statusRows ?? []) as Array<{ status: string }>) {
        counts[r.status] = (counts[r.status] ?? 0) + 1;
      }
      iporto = {
        envio_counts: counts,
        // Últimos 50 eventos do stats.event_log pra timeline (formato:
        // "<message_id>:<event_type>"). O webhook anexa cada novo evento.
        event_log: Array.isArray(
          (dispatch.stats as { event_log?: unknown })?.event_log
        )
          ? ((dispatch.stats as { event_log: string[] }).event_log ?? []).slice(-50)
          : [],
        last_event_at:
          ((dispatch.stats as { last_event_at?: string })?.last_event_at as string) ??
          null,
      };
    }

    // GA4 revenue attribution
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

    return NextResponse.json({ dispatch, locaweb, iporto, ga4 });
  } catch (err) {
    return handleAuthError(err);
  }
}
