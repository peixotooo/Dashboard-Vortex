import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getWapiConfig,
  sendText,
  sendImage,
  sendVideo,
  sendAudio,
  sendDocument,
  checkInstanceHealth,
  getGroupParticipants,
  participantPhone,
  WapiMessageType,
} from "@/lib/wapi-api";

const MAX_MENTIONS_PER_MESSAGE = 50;

export const maxDuration = 120;

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId)
      return NextResponse.json(
        { error: "Workspace not specified" },
        { status: 400 }
      );

    const config = await getWapiConfig(workspaceId);
    if (!config)
      return NextResponse.json(
        { error: "W-API not configured" },
        { status: 400 }
      );

    const body = await request.json();
    const {
      groups,
      messageType,
      message,
      caption,
      mediaUrl,
      fileName,
      extension,
      delayMessage,
      scheduled_at,
      mentionAll,
    } = body as {
      groups: Array<{ jid: string; name?: string }>;
      messageType: WapiMessageType;
      message?: string;
      caption?: string;
      mediaUrl?: string;
      fileName?: string;
      extension?: string;
      delayMessage?: number;
      scheduled_at?: string;
      mentionAll?: boolean;
    };

    if (!groups || groups.length === 0) {
      return NextResponse.json(
        { error: "No groups selected" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const delay = delayMessage ?? 1;

    // Create dispatch record
    const isScheduled =
      scheduled_at && new Date(scheduled_at).getTime() > Date.now();

    // For immediate sends, validate the W-API session is genuinely healthy
    // BEFORE dispatching anything. If the session is broken, sends would be
    // accepted and queued internally, then fire in a burst on reconnect.
    if (!isScheduled) {
      const health = await checkInstanceHealth(config);
      if (!health.healthy) {
        return NextResponse.json(
          {
            error:
              health.reason ||
              "Sessao W-API nao esta saudavel. Tente reconectar antes de enviar.",
          },
          { status: 409 }
        );
      }
    }

    // Schedule + mentionAll combo requires a migration we haven't applied
    // yet (column wapi_group_dispatches.mention_all). Block this combo with
    // a clear error until migration-065 lands.
    if (isScheduled && mentionAll === true) {
      return NextResponse.json(
        {
          error:
            "Mencao @todos em disparos agendados ainda nao esta disponivel — aplique a migration 065 e tente de novo, ou envie imediatamente.",
        },
        { status: 400 }
      );
    }

    const dispatchInsert: Record<string, unknown> = {
      workspace_id: workspaceId,
      message_type: messageType,
      content: message || caption || null,
      media_url: mediaUrl || null,
      file_name: fileName || null,
      file_extension: extension || null,
      delay_seconds: delay,
      status: isScheduled ? "scheduled" : "sending",
      scheduled_at: isScheduled ? scheduled_at : null,
      started_at: isScheduled ? null : new Date().toISOString(),
      target_groups: groups.map((g) => ({
        jid: g.jid,
        name: g.name || null,
      })),
      total_groups: groups.length,
      sent_by: user.id,
    };

    const { data: dispatch, error: dispatchError } = await admin
      .from("wapi_group_dispatches")
      .insert(dispatchInsert)
      .select("id")
      .single();

    if (dispatchError || !dispatch) {
      return NextResponse.json(
        { error: "Failed to create dispatch" },
        { status: 500 }
      );
    }

    // If scheduled, return immediately — cron will process
    if (isScheduled) {
      return NextResponse.json({
        dispatch_id: dispatch.id,
        status: "scheduled",
        scheduled_at,
        total: groups.length,
      });
    }

    // Send immediately
    const results: Array<{
      group: string;
      name?: string;
      sent: boolean;
      error?: string;
    }> = [];

    for (const group of groups) {
      try {
        // --- Resolve mentions per group (mention-all only) ---
        let mentionedPhones: string[] | undefined;
        let mentionPrefix = "";
        if (mentionAll) {
          try {
            const participants = await getGroupParticipants(config, group.jid);
            const phones = participants
              .map((p) => participantPhone(p))
              .filter((x): x is string => !!x);
            // Dedupe
            const unique = Array.from(new Set(phones));
            if (unique.length === 0) {
              throw new Error(
                "W-API nao retornou participantes resolviveis para este grupo (talvez todos estejam em formato @lid sem phoneNumber mapeado)."
              );
            }
            if (unique.length > MAX_MENTIONS_PER_MESSAGE) {
              throw new Error(
                `Grupo tem ${unique.length} participantes resolviveis (limite ${MAX_MENTIONS_PER_MESSAGE}). Reduza o publico ou envie sem mencao.`
              );
            }
            mentionedPhones = unique;
            mentionPrefix = unique.map((p) => `@${p}`).join(" ");
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            try {
              await admin.from("wapi_group_messages").insert({
                workspace_id: workspaceId,
                dispatch_id: dispatch.id,
                group_jid: group.jid,
                group_name: group.name || null,
                message_type: messageType,
                content: message || caption || null,
                media_url: mediaUrl || null,
                file_name: fileName || null,
                status: "failed",
                error_message: `Falha ao resolver mencoes: ${errMsg}`,
                sent_by: user.id,
              });
            } catch {
              // ignore logging error
            }
            results.push({
              group: group.jid,
              name: group.name,
              sent: false,
              error: `Falha ao resolver mencoes: ${errMsg}`,
            });
            continue;
          }
        }

        const baseMessage = message || "";
        const baseCaption = caption || "";
        const finalMessage = mentionPrefix
          ? `${baseMessage}${baseMessage ? "\n\n" : ""}${mentionPrefix}`
          : baseMessage;
        const finalCaption = mentionPrefix
          ? `${baseCaption}${baseCaption ? "\n\n" : ""}${mentionPrefix}`
          : baseCaption || undefined;
        const opts = mentionedPhones
          ? { mentioned: mentionedPhones }
          : undefined;

        let sendResult;
        switch (messageType) {
          case "text":
            sendResult = await sendText(
              config,
              group.jid,
              finalMessage,
              delay,
              opts
            );
            break;
          case "image":
            sendResult = await sendImage(
              config,
              group.jid,
              mediaUrl || "",
              finalCaption,
              delay,
              opts
            );
            break;
          case "video":
            sendResult = await sendVideo(
              config,
              group.jid,
              mediaUrl || "",
              finalCaption,
              delay,
              opts
            );
            break;
          case "audio":
            sendResult = await sendAudio(
              config,
              group.jid,
              mediaUrl || "",
              delay
            );
            break;
          case "document":
            sendResult = await sendDocument(
              config,
              group.jid,
              mediaUrl || "",
              extension || "pdf",
              fileName,
              finalCaption,
              delay,
              opts
            );
            break;
          default:
            throw new Error(`Unknown message type: ${messageType}`);
        }

        const sent = !sendResult.error && !!sendResult.messageId;
        const errMsg = sendResult.error
          ? sendResult.error
          : !sendResult.messageId
            ? "W-API aceitou a chamada mas nao retornou messageId (mensagem provavelmente nao foi entregue)"
            : null;

        try {
          await admin.from("wapi_group_messages").insert({
            workspace_id: workspaceId,
            dispatch_id: dispatch.id,
            group_jid: group.jid,
            group_name: group.name || null,
            message_type: messageType,
            content: message || caption || null,
            media_url: mediaUrl || null,
            file_name: fileName || null,
            status: sent ? "sent" : "failed",
            error_message: errMsg,
            sent_by: user.id,
          });
        } catch {
          // ignore logging error
        }

        results.push({
          group: group.jid,
          name: group.name,
          sent,
          error: errMsg || undefined,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";

        try {
          await admin.from("wapi_group_messages").insert({
            workspace_id: workspaceId,
            dispatch_id: dispatch.id,
            group_jid: group.jid,
            group_name: group.name || null,
            message_type: messageType,
            content: message || caption || null,
            media_url: mediaUrl || null,
            file_name: fileName || null,
            status: "failed",
            error_message: errMsg,
            sent_by: user.id,
          });
        } catch {
          // ignore logging error
        }

        results.push({
          group: group.jid,
          name: group.name,
          sent: false,
          error: errMsg,
        });
      }
    }

    const sentCount = results.filter((r) => r.sent).length;

    // Update dispatch with final counts
    await admin
      .from("wapi_group_dispatches")
      .update({
        status: "completed",
        sent_count: sentCount,
        failed_count: groups.length - sentCount,
        completed_at: new Date().toISOString(),
      })
      .eq("id", dispatch.id);

    return NextResponse.json({
      dispatch_id: dispatch.id,
      results,
      total: groups.length,
      sent: sentCount,
      failed: groups.length - sentCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
