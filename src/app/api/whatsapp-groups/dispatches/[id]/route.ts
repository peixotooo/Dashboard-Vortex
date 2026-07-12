import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { id } = await params;
    const admin = createAdminClient();

    const { data: dispatch, error } = await admin
      .from("wapi_group_dispatches")
      .select("*")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (error || !dispatch)
      return NextResponse.json(
        { error: "Dispatch not found" },
        { status: 404 },
      );

    const { data: messages } = await admin
      .from("wapi_group_messages")
      .select("group_jid, group_name, status, error_message, created_at")
      .eq("dispatch_id", id)
      .order("created_at");

    return NextResponse.json({
      dispatch,
      messages: messages || [],
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

// PATCH = editar rascunho/agendamento.
// Permite mudar conteudo (text ou caption), media, scheduled_at, delay.
// Status final:
//   - draft   → segue draft (scheduled_at livre)
//   - scheduled/queued → vira scheduled, scheduled_at obrigatorio no futuro
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const admin = createAdminClient();

    const { data: dispatch } = await admin
      .from("wapi_group_dispatches")
      .select("id, status, message_type, payload")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!dispatch)
      return NextResponse.json(
        { error: "Dispatch nao encontrado" },
        { status: 404 },
      );

    const editableStatuses = ["draft", "scheduled", "queued"];
    if (!editableStatuses.includes(dispatch.status)) {
      return NextResponse.json(
        {
          error: `Disparo com status "${dispatch.status}" nao pode ser editado.`,
        },
        { status: 400 },
      );
    }

    const updates: Record<string, unknown> = {};

    if (typeof body.content === "string") {
      // string vazia limpa o conteudo (so faz sentido se tiver media)
      updates.content = body.content;
      if (
        dispatch.payload &&
        typeof dispatch.payload === "object" &&
        !Array.isArray(dispatch.payload) &&
        Object.keys(dispatch.payload).length > 0
      ) {
        const payload = { ...dispatch.payload } as Record<string, unknown>;
        const messageTypes = [
          "text",
          "button_actions",
          "buttons",
          "otp",
          "carousel",
          "poll",
        ];
        const captionTypes = ["image", "video", "document", "gif"];
        if (messageTypes.includes(dispatch.message_type)) {
          payload.message = body.content;
          updates.payload = payload;
        } else if (captionTypes.includes(dispatch.message_type)) {
          payload.caption = body.content;
          updates.payload = payload;
        }
      }
    }
    if (typeof body.media_url === "string") {
      updates.media_url = body.media_url || null;
    }
    if (typeof body.file_name === "string") {
      updates.file_name = body.file_name || null;
    }
    if (typeof body.file_extension === "string") {
      updates.file_extension = body.file_extension || null;
    }
    if (typeof body.delay_seconds === "number" && body.delay_seconds >= 0) {
      updates.delay_seconds = Math.floor(body.delay_seconds);
    }
    if (Array.isArray(body.target_groups)) {
      // Aceita re-selecao de grupos no rascunho. Cada item precisa de jid.
      const sanitized: Array<{ jid: string; name: string | null }> = (
        body.target_groups as unknown[]
      )
        .filter(
          (g): g is { jid: string; name?: string } =>
            typeof g === "object" &&
            g !== null &&
            typeof (g as { jid?: unknown }).jid === "string",
        )
        .map((g) => ({ jid: g.jid, name: g.name || null }));
      if (sanitized.length === 0) {
        return NextResponse.json(
          { error: "Selecione pelo menos um grupo." },
          { status: 400 },
        );
      }
      updates.target_groups = sanitized;
      updates.total_groups = sanitized.length;
    }

    if (Object.prototype.hasOwnProperty.call(body, "scheduled_at")) {
      const raw = body.scheduled_at;
      if (raw === null || raw === "") {
        if (dispatch.status !== "draft") {
          return NextResponse.json(
            { error: "So rascunhos podem ficar sem data prevista." },
            { status: 400 },
          );
        }
        updates.scheduled_at = null;
      } else if (typeof raw === "string") {
        const when = new Date(raw);
        if (Number.isNaN(when.getTime())) {
          return NextResponse.json(
            { error: "scheduled_at invalido" },
            { status: 400 },
          );
        }
        if (dispatch.status !== "draft" && when.getTime() <= Date.now()) {
          return NextResponse.json(
            { error: "scheduled_at deve ser no futuro." },
            { status: 400 },
          );
        }
        updates.scheduled_at = when.toISOString();
        if (dispatch.status === "queued" && when.getTime() > Date.now()) {
          updates.status = "scheduled";
          updates.started_at = null;
        }
      } else {
        return NextResponse.json(
          { error: "scheduled_at invalido" },
          { status: 400 },
        );
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "Nada pra atualizar." },
        { status: 400 },
      );
    }

    const { data: updated, error: upErr } = await admin
      .from("wapi_group_dispatches")
      .update(updates)
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .select()
      .single();
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ dispatch: updated });
  } catch (error) {
    return handleAuthError(error);
  }
}

// DELETE com `?hard=true` faz remocao real (so pra disparos que nunca
// foram enviados). Sem o param, mantem o comportamento antigo: marca
// como cancelled (soft delete pra preservar historico).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { id } = await params;
    const url = new URL(request.url);
    const hard = url.searchParams.get("hard") === "true";
    const admin = createAdminClient();

    const { data: dispatch } = await admin
      .from("wapi_group_dispatches")
      .select("id, status, sent_count")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!dispatch)
      return NextResponse.json(
        { error: "Dispatch nao encontrado" },
        { status: 404 },
      );

    if (hard) {
      const deletable = ["draft", "scheduled", "queued", "cancelled"];
      if (!deletable.includes(dispatch.status)) {
        return NextResponse.json(
          {
            error: `Disparo com status "${dispatch.status}" nao pode ser excluido — so cancelar.`,
          },
          { status: 400 },
        );
      }
      if ((dispatch.sent_count || 0) > 0) {
        return NextResponse.json(
          { error: "Disparo ja enviou mensagens — nao pode ser excluido." },
          { status: 400 },
        );
      }

      const { error: delErr } = await admin
        .from("wapi_group_dispatches")
        .delete()
        .eq("id", id)
        .eq("workspace_id", workspaceId);
      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    // Comportamento antigo (soft cancel) — preserva pra dispatch-log nao quebrar.
    if (dispatch.status !== "scheduled" && dispatch.status !== "draft") {
      return NextResponse.json(
        { error: "So agendamentos/rascunhos podem ser cancelados" },
        { status: 400 },
      );
    }

    await admin
      .from("wapi_group_dispatches")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleAuthError(error);
  }
}
