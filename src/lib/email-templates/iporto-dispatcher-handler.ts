// src/lib/email-templates/iporto-dispatcher-handler.ts
//
// Handler compartilhado pelos crons paralelos do iporto-dispatcher.
// Múltiplas paths no vercel.json (iporto-dispatcher, -2, -3, ...) caem
// nesse mesmo handler. SELECT FOR UPDATE SKIP LOCKED na RPC
// claim_iporto_envios garante zero duplicação entre lanes.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  createDelivery,
  extractMessageId,
  type IportoError,
} from "@/lib/iporto/email-marketing";
import { getIportoSettings } from "@/lib/iporto/settings";

const BATCH_SIZE = 1000;
const CONCURRENCY = 20;
const SOFT_TIME_BUDGET_MS = 50_000;

interface EnvioRow {
  id: number;
  dispatch_id: string;
  workspace_id: string;
  email: string;
  name: string | null;
  vars: Record<string, string | number | boolean> | null;
  attempts: number;
}

interface DispatchRow {
  id: string;
  workspace_id: string;
  html_body: string | null;
  subject: string | null;
  from_email: string | null;
  from_name: string | null;
  stats: Record<string, unknown> | null;
}

export async function runIportoDispatcher(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const admin = createAdminClient();

  const { data: claimed, error: claimErr } = await admin.rpc(
    "claim_iporto_envios",
    { p_limit: BATCH_SIZE }
  );
  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  const envios = (claimed ?? []) as EnvioRow[];
  if (envios.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, skipped: "empty queue" });
  }

  const dispatchIds = [...new Set(envios.map((e) => e.dispatch_id))];
  const workspaceIds = [...new Set(envios.map((e) => e.workspace_id))];

  const { data: dispatchesRaw } = await admin
    .from("email_template_dispatches")
    .select("id, workspace_id, html_body, subject, from_email, from_name, stats")
    .in("id", dispatchIds);
  const dispatches = new Map<string, DispatchRow>();
  for (const d of (dispatchesRaw ?? []) as DispatchRow[]) {
    dispatches.set(d.id, d);
  }

  const credsByWorkspace = new Map<
    string,
    { base_url: string; token: string } | null
  >();
  for (const wid of workspaceIds) {
    const s = await getIportoSettings(wid);
    if (s.token) {
      credsByWorkspace.set(wid, { base_url: s.base_url, token: s.token });
    } else {
      credsByWorkspace.set(wid, null);
    }
  }

  let sent = 0;
  let failed = 0;
  let requeued = 0;
  const dispatchUpdates = new Map<
    string,
    { sent: number; failed: number; messageIds: string[] }
  >();

  for (let i = 0; i < envios.length; i += CONCURRENCY) {
    if (Date.now() - start > SOFT_TIME_BUDGET_MS) {
      const remaining = envios.slice(i);
      const remainingIds = remaining.map((e) => e.id);
      await admin
        .from("email_template_iporto_envios")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .in("id", remainingIds);
      break;
    }

    const batch = envios.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((e) => processOne(e, dispatches, credsByWorkspace))
    );

    for (let j = 0; j < results.length; j++) {
      const res = results[j];
      const e = batch[j];
      if (res.status === "fulfilled") {
        if (res.value.ok) {
          sent++;
          const agg = dispatchUpdates.get(e.dispatch_id) ?? {
            sent: 0,
            failed: 0,
            messageIds: [],
          };
          agg.sent++;
          if (res.value.messageId) agg.messageIds.push(res.value.messageId);
          dispatchUpdates.set(e.dispatch_id, agg);
        } else if (res.value.requeued) {
          requeued++;
        } else {
          failed++;
          const agg = dispatchUpdates.get(e.dispatch_id) ?? {
            sent: 0,
            failed: 0,
            messageIds: [],
          };
          agg.failed++;
          dispatchUpdates.set(e.dispatch_id, agg);
        }
      } else {
        failed++;
        await admin.rpc("requeue_iporto_envio", {
          p_id: e.id,
          p_error: String(res.reason).slice(0, 240),
        });
      }
    }
  }

  for (const [dispatchId, agg] of dispatchUpdates.entries()) {
    const dispatch = dispatches.get(dispatchId);
    if (!dispatch) continue;

    const { data: cur } = await admin
      .from("email_template_dispatches")
      .select("recipients_sent, recipients_failed, recipients_total, iporto_message_ids")
      .eq("id", dispatchId)
      .single();
    const curSent = (cur?.recipients_sent as number) ?? 0;
    const curFailed = (cur?.recipients_failed as number) ?? 0;
    const total = (cur?.recipients_total as number) ?? 0;
    const newSent = curSent + agg.sent;
    const newFailed = curFailed + agg.failed;
    const processed = newSent + newFailed;
    const status =
      processed >= total
        ? newFailed >= total
          ? "failed"
          : "sent"
        : "queued";

    const existingMsgIds = (cur?.iporto_message_ids ?? []) as string[];
    const mergedMsgIds = [...existingMsgIds, ...agg.messageIds];

    await admin
      .from("email_template_dispatches")
      .update({
        recipients_sent: newSent,
        recipients_failed: newFailed,
        iporto_message_ids: mergedMsgIds,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", dispatchId);
  }

  return NextResponse.json({
    ok: true,
    claimed: envios.length,
    sent,
    failed,
    requeued,
    duration_ms: Date.now() - start,
  });
}

async function processOne(
  envio: EnvioRow,
  dispatches: Map<string, DispatchRow>,
  credsByWorkspace: Map<string, { base_url: string; token: string } | null>
): Promise<{ ok: true; messageId?: string } | { ok: false; requeued: boolean }> {
  const admin = createAdminClient();
  const dispatch = dispatches.get(envio.dispatch_id);
  if (!dispatch) {
    await admin
      .from("email_template_iporto_envios")
      .update({
        status: "failed",
        error: "dispatch row not found",
        updated_at: new Date().toISOString(),
      })
      .eq("id", envio.id);
    return { ok: false, requeued: false };
  }

  const creds = credsByWorkspace.get(envio.workspace_id);
  if (!creds) {
    await admin.rpc("requeue_iporto_envio", {
      p_id: envio.id,
      p_error: "workspace sem credenciais iPORTO",
    });
    return { ok: false, requeued: true };
  }

  if (!dispatch.html_body || !dispatch.subject || !dispatch.from_email) {
    await admin
      .from("email_template_iporto_envios")
      .update({
        status: "failed",
        error: "dispatch sem html/subject/from",
        updated_at: new Date().toISOString(),
      })
      .eq("id", envio.id);
    return { ok: false, requeued: false };
  }

  let html = dispatch.html_body;
  const vars = envio.vars ?? {};
  vars.name = vars.name ?? envio.name ?? "";
  vars.email = vars.email ?? envio.email;
  for (const [k, v] of Object.entries(vars)) {
    html = html.replaceAll(`{{${k}}}`, String(v));
  }

  try {
    const result = await createDelivery(creds, {
      subject: dispatch.subject,
      from: dispatch.from_email,
      from_name: dispatch.from_name ?? dispatch.from_email,
      address_to: envio.email,
      html_body: html,
      headers: {
        envio_id: String(envio.id),
        dispatch_id: envio.dispatch_id,
      },
      tags: [`dispatch:${envio.dispatch_id}`, `envio:${envio.id}`],
      // track_link OFF — iPORTO duplicava utm_source quebrando o
      // redirect. Nossas UTMs (applyUtmTracking) já levam pro GA4.
      tracking_settings: { track_open: "yes", track_link: "no" },
    });
    const messageId = extractMessageId(result);
    await admin
      .from("email_template_iporto_envios")
      .update({
        status: "sent",
        iporto_message_id: messageId,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", envio.id);
    return { ok: true, messageId: messageId ?? undefined };
  } catch (err) {
    const e = err as IportoError;
    const status = e.status ?? 0;
    if (status >= 500 || status === 429 || status === 0) {
      await admin.rpc("requeue_iporto_envio", {
        p_id: envio.id,
        p_error: (e.message ?? "").slice(0, 240),
      });
      return { ok: false, requeued: true };
    }
    await admin
      .from("email_template_iporto_envios")
      .update({
        status: "failed",
        error: (e.message ?? "").slice(0, 240),
        updated_at: new Date().toISOString(),
      })
      .eq("id", envio.id);
    return { ok: false, requeued: false };
  }
}
