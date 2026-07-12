import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWapiConfig } from "@/lib/wapi-api";
import {
  getWapiPayloadSummary,
  isWapiMessageType,
  normalizeWapiMessagePayload,
  type WapiMessagePayload,
} from "@/lib/whatsapp/wapi-message-types";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const { workspaceId, userId } = await getWorkspaceContext(request);

    const config = await getWapiConfig(workspaceId);
    if (!config)
      return NextResponse.json(
        { error: "W-API not configured" },
        { status: 400 },
      );

    const body = await request.json();
    const {
      groups,
      messageType,
      payload,
      message,
      caption,
      mediaUrl,
      fileName,
      extension,
      delayMessage,
      scheduled_at,
      save_as_draft,
    } = body as {
      groups: Array<{ jid: string; name?: string }>;
      messageType: unknown;
      payload?: WapiMessagePayload;
      message?: string;
      caption?: string;
      mediaUrl?: string;
      fileName?: string;
      extension?: string;
      delayMessage?: number;
      scheduled_at?: string;
      save_as_draft?: boolean;
    };

    if (!Array.isArray(groups) || groups.length === 0) {
      return NextResponse.json(
        { error: "No groups selected" },
        { status: 400 },
      );
    }

    if (!isWapiMessageType(messageType)) {
      return NextResponse.json(
        { error: "Tipo de mensagem não suportado." },
        { status: 400 },
      );
    }

    const sanitizedGroups = groups
      .filter(
        (group): group is { jid: string; name?: string } =>
          !!group &&
          typeof group.jid === "string" &&
          group.jid.endsWith("@g.us"),
      )
      .map((group) => ({
        jid: group.jid.trim(),
        name: typeof group.name === "string" ? group.name.trim() : undefined,
      }));

    if (sanitizedGroups.length !== groups.length) {
      return NextResponse.json(
        { error: "A seleção contém um identificador de grupo inválido." },
        { status: 400 },
      );
    }

    // Compatibilidade com clientes antigos, que enviavam os campos de mídia
    // diretamente em vez do payload estruturado.
    const legacyPayload: WapiMessagePayload = (() => {
      switch (messageType) {
        case "text":
          return { message: message || "" };
        case "image":
          return { image: mediaUrl || "", caption };
        case "video":
          return { video: mediaUrl || "", caption };
        case "audio":
          return { audio: mediaUrl || "" };
        case "document":
          return {
            document: mediaUrl || "",
            extension: extension || "pdf",
            fileName,
            caption,
          };
        default:
          return {};
      }
    })();

    let normalizedPayload: WapiMessagePayload;
    try {
      normalizedPayload = normalizeWapiMessagePayload(
        messageType,
        payload || legacyPayload,
      );
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Payload de mensagem inválido.",
        },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const rawDelay =
      typeof delayMessage === "number" && Number.isFinite(delayMessage)
        ? delayMessage
        : 1;
    const delay = Math.min(60, Math.max(0, Math.floor(rawDelay)));
    const contentSummary = getWapiPayloadSummary(
      messageType,
      normalizedPayload,
    );
    const normalizedMediaUrl =
      typeof normalizedPayload.image === "string"
        ? normalizedPayload.image
        : typeof normalizedPayload.video === "string"
          ? normalizedPayload.video
          : typeof normalizedPayload.audio === "string"
            ? normalizedPayload.audio
            : typeof normalizedPayload.document === "string"
              ? normalizedPayload.document
              : typeof normalizedPayload.sticker === "string"
                ? normalizedPayload.sticker
                : typeof normalizedPayload.gif === "string"
                  ? normalizedPayload.gif
                  : typeof normalizedPayload.ptv === "string"
                    ? normalizedPayload.ptv
                    : null;

    // Decide o status inicial.
    // - draft: usuário ativa manualmente depois (cron já ignora).
    // - scheduled: data futura → cron dispara na data.
    // - queued: envio imediato → worker do Droplet dispara no próximo tick.
    const isScheduled =
      !save_as_draft &&
      scheduled_at &&
      new Date(scheduled_at).getTime() > Date.now();
    const isDraft = !!save_as_draft;

    const initialStatus = isDraft
      ? "draft"
      : isScheduled
        ? "scheduled"
        : "queued";

    const { data: dispatch, error: dispatchError } = await admin
      .from("wapi_group_dispatches")
      .insert({
        workspace_id: workspaceId,
        message_type: messageType,
        content: contentSummary,
        media_url: normalizedMediaUrl,
        file_name:
          typeof normalizedPayload.fileName === "string"
            ? normalizedPayload.fileName
            : null,
        file_extension:
          typeof normalizedPayload.extension === "string"
            ? normalizedPayload.extension
            : null,
        payload: normalizedPayload,
        delay_seconds: delay,
        status: initialStatus,
        // Pra draft, persistimos scheduled_at mesmo se já passou — usuário
        // pode editar depois ou simplesmente ativar pra envio imediato.
        scheduled_at: initialStatus === "queued" ? null : scheduled_at || null,
        started_at: null,
        target_groups: sanitizedGroups.map((g) => ({
          jid: g.jid,
          name: g.name || null,
        })),
        total_groups: sanitizedGroups.length,
        sent_by: userId,
      })
      .select("id")
      .single();

    if (dispatchError || !dispatch) {
      return NextResponse.json(
        { error: "Failed to create dispatch" },
        { status: 500 },
      );
    }

    // Rascunho ou agendamento: retorna agora, cron ou ativação cuidam depois.
    if (isDraft) {
      return NextResponse.json({
        dispatch_id: dispatch.id,
        status: "draft",
        scheduled_at: scheduled_at || null,
        total: sanitizedGroups.length,
      });
    }
    if (isScheduled) {
      return NextResponse.json({
        dispatch_id: dispatch.id,
        status: "scheduled",
        scheduled_at,
        total: sanitizedGroups.length,
      });
    }

    return NextResponse.json({
      dispatch_id: dispatch.id,
      status: "queued",
      queued: true,
      total: sanitizedGroups.length,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
