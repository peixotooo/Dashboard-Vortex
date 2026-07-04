// src/app/api/webhooks/iporto/route.ts
//
// Webhook do iPORTO. iPORTO chama esse endpoint a cada evento
// (delivered, opened, clicked, bounced, complained, unsubscribed).
//
// Diferente da Locaweb (que não tem webhook e exige polling), aqui
// agregamos os eventos no campo stats do email_template_dispatches
// — incrementando contadores delivered/opened/clicked/bounced. Também
// atualizamos o envio individual em email_template_iporto_envios
// quando achamos o iporto_message_id (envios via cron-dispatcher).
//
// Idempotência: cada (message_id, tipo) só conta uma vez. O campo
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
  message_tracking_code?: string;
  tracking_code?: string;
  id?: string;
  // Algumas instalações encapsulam em `data` (igual o POST de delivery).
  data?: {
    message_id?: string;
    request_id?: string;
    message_tracking_code?: string;
    tracking_code?: string;
    id?: string;
  };
  event?: string;
  type?: string;
  status?: string;
  timestamp?: string;
  email?: string;
  bounce_type?: string;
  [k: string]: unknown;
}

function extractWebhookMessageId(body: IportoEvent): string | null {
  return (
    body.message_tracking_code ??
    body.tracking_code ??
    body.message_id ??
    body.request_id ??
    body.id ??
    body.data?.message_tracking_code ??
    body.data?.tracking_code ??
    body.data?.message_id ??
    body.data?.request_id ??
    body.data?.id ??
    null
  );
}

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

const ENVIO_TERMINAL_EVENTS: Record<string, "sent" | "failed"> = {
  delivered: "sent",
  bounced: "failed",
  complained: "failed",
};

type Admin = ReturnType<typeof createAdminClient>;

async function verifySecret(
  admin: Admin,
  workspaceId: string,
  req: NextRequest
): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const { data: settings } = await admin
    .from("workspace_email_marketing")
    .select("iporto_webhook_secret")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const expectedSecret =
    (settings as { iporto_webhook_secret?: string } | null)?.iporto_webhook_secret ||
    process.env.IPORTO_WEBHOOK_SECRET ||
    null;
  if (!expectedSecret) {
    return {
      ok: false,
      res: NextResponse.json({ error: "webhook secret not configured" }, { status: 503 }),
    };
  }
  const headerSecret = req.headers.get("x-webhook-secret");
  const querySecret = req.nextUrl.searchParams.get("secret");
  if (headerSecret === expectedSecret || querySecret === expectedSecret) {
    return { ok: true };
  }
  return {
    ok: false,
    res: NextResponse.json({ error: "invalid webhook secret" }, { status: 401 }),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as IportoEvent;
    const messageId = extractWebhookMessageId(body);
    const eventType = (body.event ?? body.type ?? body.status ?? "").toLowerCase();
    console.log("[webhook/iporto] event received:", {
      has_message_id: !!messageId,
      event_type: eventType || null,
    });
    if (!messageId || !eventType) {
      console.warn(
        "[webhook/iporto] ignored — missing fields. messageId=",
        messageId,
        "eventType=",
        eventType
      );
      return NextResponse.json({
        ok: true,
        ignored: "missing fields",
        debug: { has_message_id: !!messageId, has_event_type: !!eventType },
      });
    }

    const admin = createAdminClient();

    // 1. Localiza envio individual pelo iporto_message_id (caminho do
    // cron-dispatcher).
    const { data: envio } = await admin
      .from("email_template_iporto_envios")
      .select("id, dispatch_id, workspace_id, status")
      .eq("iporto_message_id", messageId)
      .maybeSingle();

    let dispatchId: string;
    let workspaceId: string;

    // Escrita do status do envio fica PENDENTE até o segredo ser verificado
    // (nada de escrever antes da auth).
    let pendingEnvioUpdate: { id: number; status: string } | null = null;

    if (envio) {
      const e = envio as {
        id: number;
        dispatch_id: string;
        workspace_id: string;
        status: string;
      };
      dispatchId = e.dispatch_id;
      workspaceId = e.workspace_id;

      const envioStatus = ENVIO_TERMINAL_EVENTS[eventType];
      if (envioStatus && e.status !== envioStatus) {
        pendingEnvioUpdate = { id: e.id, status: envioStatus };
      }
    } else {
      // 2. Fallback pro dispatch antigo (síncrono) que armazenava todos
      // os message_ids no array iporto_message_ids do próprio dispatch.
      const { data: dispatches } = await admin
        .from("email_template_dispatches")
        .select("id, workspace_id")
        .contains("iporto_message_ids", [messageId])
        .limit(1);
      const fallback = dispatches?.[0] as
        | { id: string; workspace_id: string }
        | undefined;
      if (!fallback) {
        console.warn(
          "[webhook/iporto] envio not found for messageId=",
          messageId,
          "event=",
          eventType
        );
        return NextResponse.json({
          ok: true,
          ignored: "envio not found",
          message_id: messageId,
        });
      }
      dispatchId = fallback.id;
      workspaceId = fallback.workspace_id;
    }

    const auth = await verifySecret(admin, workspaceId, req);
    if (!auth.ok) return auth.res;

    // Segredo verificado → agora sim aplica a escrita de status do envio.
    if (pendingEnvioUpdate) {
      await admin
        .from("email_template_iporto_envios")
        .update({
          status: pendingEnvioUpdate.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", pendingEnvioUpdate.id);
    }

    // 3. Agrega no stats do dispatch (idempotente via event_log).
    const { data: dispatch } = await admin
      .from("email_template_dispatches")
      .select("id, stats")
      .eq("id", dispatchId)
      .maybeSingle();
    if (!dispatch) {
      return NextResponse.json({ ok: true, ignored: "dispatch not found" });
    }
    const stats: DispatchStats = ((dispatch as { stats?: DispatchStats }).stats ??
      {}) as DispatchStats;
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
      .eq("id", dispatchId);

    console.log(
      `[webhook/iporto] +1 ${counterKey ?? eventType} dispatch=${dispatchId}`
    );
    return NextResponse.json({ ok: true, counter: counterKey ?? null });
  } catch (err) {
    console.error("[webhook/iporto] error:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
