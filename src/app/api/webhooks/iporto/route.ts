// src/app/api/webhooks/iporto/route.ts
//
// Webhook do iPORTO. iPORTO chama esse endpoint a cada evento
// (delivered, opened, clicked, bounced, complained, unsubscribed).
//
// Diferente da Locaweb (que não tem webhook e exige polling), aqui
// agregamos os eventos no campo stats do email_template_dispatches
// — incrementando contadores delivered/opened/clicked/bounced.
//
// IdempotÊncia: cada (message_id, tipo) só conta uma vez. O campo
// stats.event_log armazena os pares (message_id, tipo) processados.
//
// Auth: o iPORTO permite configurar um secret no painel; verificamos
// via header X-Webhook-Secret OU query param ?secret=... (algumas
// instâncias do iPORTO mandam um ou outro). Cada workspace tem seu
// próprio secret em workspace_email_marketing.iporto_webhook_secret.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 15;

interface IportoEvent {
  message_id?: string;
  request_id?: string;
  event?: string;
  type?: string;
  timestamp?: string;
  email?: string;
  bounce_type?: string;
  [k: string]: unknown;
}

const STATUS_INC: Record<string, keyof DispatchStats> = {
  delivered: "delivered",
  opened: "opens",
  open: "opens",
  clicked: "clicks",
  click: "clicks",
  bounced: "bounces",
  bounce: "bounces",
  complained: "complaints",
  complaint: "complaints",
  unsubscribed: "unsubscribes",
  unsubscribe: "unsubscribes",
};

interface DispatchStats {
  delivered?: number;
  opens?: number;
  clicks?: number;
  bounces?: number;
  complaints?: number;
  unsubscribes?: number;
  event_log?: string[];
  [k: string]: unknown;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as IportoEvent;
    const messageId = body.message_id ?? body.request_id;
    const eventType = (body.event ?? body.type ?? "").toLowerCase();
    if (!messageId || !eventType) {
      return NextResponse.json({ ok: true, ignored: "missing fields" });
    }

    const admin = createAdminClient();

    // Localiza o dispatch pelo iporto_message_ids (array). PostgreSQL
    // permite contains-on-array via .contains.
    const { data: dispatches } = await admin
      .from("email_template_dispatches")
      .select(
        "id, workspace_id, stats, iporto_message_ids"
      )
      .contains("iporto_message_ids", [messageId])
      .limit(1);

    const dispatch = dispatches?.[0] as
      | {
          id: string;
          workspace_id: string;
          stats: DispatchStats | null;
          iporto_message_ids: string[] | null;
        }
      | undefined;
    if (!dispatch) {
      // 200 mesmo assim — iPORTO pode reenviar e não queremos retry storm.
      return NextResponse.json({ ok: true, ignored: "dispatch not found" });
    }

    // Auth via secret do workspace.
    const { data: settings } = await admin
      .from("workspace_email_marketing")
      .select("iporto_webhook_secret")
      .eq("workspace_id", dispatch.workspace_id)
      .maybeSingle();
    const expectedSecret = (settings as { iporto_webhook_secret?: string } | null)
      ?.iporto_webhook_secret;
    if (expectedSecret) {
      const headerSecret = req.headers.get("x-webhook-secret");
      const querySecret = req.nextUrl.searchParams.get("secret");
      if (headerSecret !== expectedSecret && querySecret !== expectedSecret) {
        return NextResponse.json(
          { error: "invalid webhook secret" },
          { status: 401 }
        );
      }
    }

    // IdempotÊncia via stats.event_log
    const stats: DispatchStats = (dispatch.stats ?? {}) as DispatchStats;
    const eventKey = `${messageId}:${eventType}`;
    const log = Array.isArray(stats.event_log) ? [...stats.event_log] : [];
    if (log.includes(eventKey)) {
      return NextResponse.json({ ok: true, dedup: true });
    }
    log.push(eventKey);

    const counterKey = STATUS_INC[eventType];
    if (counterKey) {
      const current = Number(stats[counterKey] ?? 0);
      stats[counterKey] = current + 1;
    }
    stats.event_log = log;
    stats.last_event_at = body.timestamp ?? new Date().toISOString();

    await admin
      .from("email_template_dispatches")
      .update({
        stats,
        updated_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", dispatch.id);

    return NextResponse.json({ ok: true, counter: counterKey ?? null });
  } catch (err) {
    console.error("[webhook/iporto] error:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
