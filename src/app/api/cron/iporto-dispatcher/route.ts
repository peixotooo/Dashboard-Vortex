// src/app/api/cron/iporto-dispatcher/route.ts
//
// Cron consumidor da fila iPORTO. Roda a cada minuto, faz claim de
// até BATCH_SIZE envios pendentes via SELECT ... FOR UPDATE SKIP LOCKED
// (RPC claim_iporto_envios), envia cada um em paralelo limitado e
// atualiza status.
//
// Throughput por invocação:
//   - BATCH = 1000
//   - CONCURRENCY = 20
//   - latência iPORTO ~500ms/req → 20 req/s = 1200/min
//   - cap por maxDuration (50s úteis) ~1000 envios
//
// Pra escalar: agendar múltiplas paths no vercel.json
// (`iporto-dispatcher`, `iporto-dispatcher-2`, ...). SKIP LOCKED garante
// que não duplicam.
//
// Retry: erros 5xx/429 voltam pra status='pending' com backoff
// exponencial (5s → 80s). Após 5 tentativas vira 'failed'. Erros
// 4xx (validação) viram 'failed' direto.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createDelivery, type IportoError } from "@/lib/iporto/email-marketing";
import { getIportoSettings } from "@/lib/iporto/settings";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 1000;
const CONCURRENCY = 20;
const SOFT_TIME_BUDGET_MS = 50_000; // deixa 10s de margem pro Vercel

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

export async function POST(req: NextRequest) {
  return handle(req);
}
export async function GET(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const admin = createAdminClient();

  // 1. Claim batch — atualiza status='processing' atomicamente.
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

  // 2. Group por dispatch — carregamos dispatch + creds 1x por dispatch.
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

  // creds por workspace
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

  // 3. Processa em paralelo limitado. Quebra em chunks de CONCURRENCY.
  let sent = 0;
  let failed = 0;
  let requeued = 0;
  const dispatchUpdates = new Map<
    string,
    { sent: number; failed: number; messageIds: string[] }
  >();

  for (let i = 0; i < envios.length; i += CONCURRENCY) {
    if (Date.now() - start > SOFT_TIME_BUDGET_MS) {
      // Deixa os não processados voltarem pra 'pending' implicitamente
      // (claim_iporto_envios marcou tudo como 'processing' — precisamos
      // reverter os não processados). Trata aqui.
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
        // Erro fora do controle — recoloca na fila com 1 attempt
        failed++;
        await admin.rpc("requeue_iporto_envio", {
          p_id: e.id,
          p_error: String(res.reason).slice(0, 240),
        });
      }
    }
  }

  // 4. Agrega contadores nos dispatches afetados.
  for (const [dispatchId, agg] of dispatchUpdates.entries()) {
    const dispatch = dispatches.get(dispatchId);
    if (!dispatch) continue;

    // Anexa novos message_ids ao array existente.
    if (agg.messageIds.length > 0) {
      await admin.rpc("array_append_iporto_msgs", {
        p_dispatch_id: dispatchId,
        p_ids: agg.messageIds,
      }).then(() => {}, () => {
        // RPC opcional pode não existir; faz append em JS.
        return admin
          .from("email_template_dispatches")
          .select("iporto_message_ids")
          .eq("id", dispatchId)
          .single()
          .then(async ({ data }) => {
            const existing = (data?.iporto_message_ids ?? []) as string[];
            await admin
              .from("email_template_dispatches")
              .update({
                iporto_message_ids: [...existing, ...agg.messageIds],
                updated_at: new Date().toISOString(),
              })
              .eq("id", dispatchId);
          });
      });
    }

    // Increment sent/failed via rpc não-existente → faz read-modify-write.
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

  // Interpola vars do envio no template.
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
      tracking_settings: { track_open: "yes", track_link: "yes" },
    });
    const messageId = result.message_id ?? result.request_id ?? null;
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
    // 5xx + 429 → retry com backoff
    if (status >= 500 || status === 429 || status === 0) {
      await admin.rpc("requeue_iporto_envio", {
        p_id: envio.id,
        p_error: (e.message ?? "").slice(0, 240),
      });
      return { ok: false, requeued: true };
    }
    // 4xx (auth/validação) → fail permanente
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
