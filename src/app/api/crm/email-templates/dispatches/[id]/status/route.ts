// src/app/api/crm/email-templates/dispatches/[id]/status/route.ts
//
// GET → progresso de um dispatch (sent/failed/pending/total). UI usa
// pra mostrar barra de progresso enquanto o cron iporto-dispatcher
// processa a fila. Locaweb dispatches devolvem stats direto do
// dispatches.stats (já populado pelo stats-sync cron).

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

interface DispatchRow {
  id: string;
  workspace_id: string;
  provider: string;
  status: string;
  recipients_total: number | null;
  recipients_sent: number | null;
  recipients_failed: number | null;
  stats: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await ctx.params;

    const admin = createAdminClient();
    const { data: dispatch, error } = await admin
      .from("email_template_dispatches")
      .select(
        "id, workspace_id, provider, status, recipients_total, recipients_sent, recipients_failed, stats, created_at, updated_at"
      )
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .maybeSingle<DispatchRow>();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!dispatch) {
      return NextResponse.json({ error: "dispatch not found" }, { status: 404 });
    }

    const total = dispatch.recipients_total ?? 0;
    const sent = dispatch.recipients_sent ?? 0;
    const failed = dispatch.recipients_failed ?? 0;
    const pending = Math.max(0, total - sent - failed);

    // Pra iPORTO async, somamos diretamente a tabela de envios pra ter
    // o número mais fresco (o dispatcher pode ainda estar atualizando
    // os contadores agregados).
    let queueBreakdown: {
      pending: number;
      processing: number;
      sent: number;
      failed: number;
    } | null = null;
    if (dispatch.provider === "iporto") {
      const { data: counts } = await admin
        .from("email_template_iporto_envios")
        .select("status")
        .eq("dispatch_id", id);
      if (counts) {
        queueBreakdown = { pending: 0, processing: 0, sent: 0, failed: 0 };
        for (const row of counts as Array<{ status: string }>) {
          if (row.status === "pending") queueBreakdown.pending++;
          else if (row.status === "processing") queueBreakdown.processing++;
          else if (row.status === "sent") queueBreakdown.sent++;
          else if (row.status === "failed") queueBreakdown.failed++;
        }
      }
    }

    return NextResponse.json({
      id: dispatch.id,
      provider: dispatch.provider,
      status: dispatch.status,
      recipients_total: total,
      recipients_sent: sent,
      recipients_failed: failed,
      recipients_pending: pending,
      queue_breakdown: queueBreakdown,
      stats: dispatch.stats,
      created_at: dispatch.created_at,
      updated_at: dispatch.updated_at,
    });
  } catch (err) {
    return handleAuthError(err);
  }
}
