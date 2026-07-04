import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { id } = await params;
    const admin = createAdminClient();

    const { data: campaign } = await admin
      .from("wa_campaigns")
      .select("*, wa_templates(id, meta_id, name, language, category, status, components, synced_at)")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    return NextResponse.json({ campaign });
  } catch (error) {
    return handleAuthError(error);
  }
}

// PATCH = cancel a campaign
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { id } = await params;
    const body = await request.json();

    const admin = createAdminClient();

    // Verify campaign exists and belongs to workspace
    const { data: campaign } = await admin
      .from("wa_campaigns")
      .select("id, status, started_at, sent_count")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    if (body.action === "update") {
      // Edição de rascunho / agendamento. Permite mudar nome e/ou
      // scheduled_at. Status final:
      //   - draft  → segue draft (scheduled_at pode ser qualquer valor ou null)
      //   - scheduled/queued → vira scheduled, scheduled_at obrigatório no futuro
      const editableStatuses = ["draft", "scheduled", "queued", "pending_approval"];
      if (!editableStatuses.includes(campaign.status)) {
        return NextResponse.json(
          { error: `Campanha com status "${campaign.status}" não pode ser editada.` },
          { status: 400 }
        );
      }

      const updates: Record<string, unknown> = {};

      if (typeof body.name === "string") {
        const trimmed = body.name.trim();
        if (trimmed.length === 0) {
          return NextResponse.json({ error: "Nome não pode ser vazio." }, { status: 400 });
        }
        updates.name = trimmed;
      }

      if (Object.prototype.hasOwnProperty.call(body, "scheduled_at")) {
        const raw = body.scheduled_at;
        if (raw === null || raw === "") {
          // limpar agendamento — só permitido em draft
          if (campaign.status !== "draft") {
            return NextResponse.json(
              { error: "Só rascunhos podem ficar sem data prevista." },
              { status: 400 }
            );
          }
          updates.scheduled_at = null;
        } else if (typeof raw === "string") {
          const when = new Date(raw);
          if (Number.isNaN(when.getTime())) {
            return NextResponse.json({ error: "scheduled_at inválido" }, { status: 400 });
          }
          if (campaign.status !== "draft" && when.getTime() <= Date.now()) {
            return NextResponse.json(
              { error: "scheduled_at deve ser no futuro." },
              { status: 400 }
            );
          }
          updates.scheduled_at = when.toISOString();
          // Se estava queued e ganhou data futura, volta pra scheduled.
          if (campaign.status === "queued" && when.getTime() > Date.now()) {
            updates.status = "scheduled";
            updates.started_at = null;
          }
        } else {
          return NextResponse.json({ error: "scheduled_at inválido" }, { status: 400 });
        }
      }

      // Atualização de variáveis do template — replica nas mensagens em
      // fila, re-resolvendo "{{nome}}" via contact_name.
      let nextVariableValues: Record<string, string> | null = null;
      if (Object.prototype.hasOwnProperty.call(body, "variable_values")) {
        const raw = body.variable_values;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          const cleaned: Record<string, string> = {};
          for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            if (typeof v === "string") cleaned[k] = v;
          }
          nextVariableValues = cleaned;
          updates.variable_values = cleaned;
        } else {
          return NextResponse.json({ error: "variable_values inválido" }, { status: 400 });
        }
      }

      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: "Nada pra atualizar." }, { status: 400 });
      }

      const { data: updated, error: updateErr } = await admin
        .from("wa_campaigns")
        .update(updates)
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .select()
        .single();

      if (updateErr) throw new Error(updateErr.message);

      // Se as variáveis mudaram, atualiza wa_messages ainda em fila.
      // Pra cada msg, recalcula variable_values do zero a partir do
      // novo dict da campanha, resolvendo "{{nome}}" via contact_name.
      if (nextVariableValues) {
        const { data: queuedMsgs, error: msgFetchErr } = await admin
          .from("wa_messages")
          .select("id, contact_name")
          .eq("campaign_id", id)
          .eq("status", "queued");
        if (msgFetchErr) {
          console.error("[WA Update] Erro buscando mensagens em fila:", msgFetchErr.message);
        } else if (queuedMsgs && queuedMsgs.length > 0) {
          for (const m of queuedMsgs) {
            const resolved: Record<string, string> = {};
            for (const [k, v] of Object.entries(nextVariableValues)) {
              resolved[k] = v === "{{nome}}" ? (m.contact_name as string | null) || "" : v;
            }
            const { error: upErr } = await admin
              .from("wa_messages")
              .update({ variable_values: resolved })
              .eq("id", m.id);
            if (upErr) {
              console.error(`[WA Update] Falha em msg ${m.id}:`, upErr.message);
            }
          }
        }
      }

      return NextResponse.json({ campaign: updated });
    }

    if (body.action === "cancel") {
      const cancellableStatuses = ["scheduled", "queued", "draft"];
      if (!cancellableStatuses.includes(campaign.status)) {
        return NextResponse.json(
          { error: `Campanha com status "${campaign.status}" nao pode ser cancelada` },
          { status: 400 }
        );
      }

      const { data: updated, error: updateErr } = await admin
        .from("wa_campaigns")
        .update({ status: "cancelled" })
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .select()
        .single();

      if (updateErr) throw new Error(updateErr.message);
      return NextResponse.json({ campaign: updated });
    }

    if (body.action === "reschedule") {
      const reschedulableStatuses = ["scheduled", "queued", "draft", "cancelled"];
      if (!reschedulableStatuses.includes(campaign.status)) {
        return NextResponse.json(
          { error: `Campanha com status "${campaign.status}" nao pode ser reagendada` },
          { status: 400 }
        );
      }

      const raw = body.scheduled_at;
      if (!raw || typeof raw !== "string") {
        return NextResponse.json(
          { error: "scheduled_at e obrigatorio (ISO timestamp)" },
          { status: 400 }
        );
      }
      const when = new Date(raw);
      if (Number.isNaN(when.getTime())) {
        return NextResponse.json({ error: "scheduled_at invalido" }, { status: 400 });
      }
      if (when.getTime() <= Date.now()) {
        return NextResponse.json(
          { error: "scheduled_at deve ser no futuro" },
          { status: 400 }
        );
      }

      const updates: Record<string, unknown> = {
        status: "scheduled",
        scheduled_at: when.toISOString(),
      };
      // Reset started_at if it was set on cancelled/queued — campaign hasn't dispatched
      if (!campaign.started_at || campaign.status !== "sending") {
        updates.started_at = null;
      }

      const { data: updated, error: updateErr } = await admin
        .from("wa_campaigns")
        .update(updates)
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .select()
        .single();

      if (updateErr) throw new Error(updateErr.message);
      return NextResponse.json({ campaign: updated });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return handleAuthError(error);
  }
}

// DELETE = hard remove (apenas pra campanhas que nunca dispararam).
// wa_messages cai junto pelo ON DELETE CASCADE.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { id } = await params;
    const admin = createAdminClient();

    const { data: campaign } = await admin
      .from("wa_campaigns")
      .select("id, status, sent_count")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const deletableStatuses = ["draft", "scheduled", "queued", "cancelled", "pending_approval"];
    if (!deletableStatuses.includes(campaign.status)) {
      return NextResponse.json(
        { error: `Campanha com status "${campaign.status}" não pode ser excluída — só cancelar.` },
        { status: 400 }
      );
    }
    if ((campaign.sent_count || 0) > 0) {
      return NextResponse.json(
        { error: "Campanha já enviou mensagens — não pode ser excluída." },
        { status: 400 }
      );
    }

    const { error: delErr } = await admin
      .from("wa_campaigns")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleAuthError(error);
  }
}
