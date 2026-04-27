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
            "DM individual em disparos agendados ainda nao esta disponivel — envie imediatamente, ou agende o disparo direto no grupo (sem o DM individual).",
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

    /**
     * Send the configured payload to a single recipient (group jid OR
     * private phone). Returns { sent, error, messageId }.
     */
    const sendOne = async (
      recipientPhone: string,
      msgText: string,
      capText: string | undefined
    ) => {
      switch (messageType) {
        case "text":
          return sendText(config, recipientPhone, msgText, delay);
        case "image":
          return sendImage(config, recipientPhone, mediaUrl || "", capText, delay);
        case "video":
          return sendVideo(config, recipientPhone, mediaUrl || "", capText, delay);
        case "audio":
          return sendAudio(config, recipientPhone, mediaUrl || "", delay);
        case "document":
          return sendDocument(
            config,
            recipientPhone,
            mediaUrl || "",
            extension || "pdf",
            fileName,
            capText,
            delay
          );
        default:
          throw new Error(`Unknown message type: ${messageType}`);
      }
    };

    for (const group of groups) {
      try {
        // ============================================================
        // Mode A: mentionAll = true -> send a private DM to each
        // resolvable participant of this group. Each user only sees
        // their own copy; the group itself is not posted to.
        // ============================================================
        if (mentionAll) {
          let recipients: string[] = [];
          try {
            const participants = await getGroupParticipants(config, group.jid);
            const phones = participants
              .map((p) => participantPhone(p))
              .filter((x): x is string => !!x);
            recipients = Array.from(new Set(phones));
            if (recipients.length === 0) {
              throw new Error(
                "W-API nao retornou participantes resolviveis para este grupo (todos podem estar em formato @lid sem phoneNumber mapeado)."
              );
            }
            if (recipients.length > MAX_MENTIONS_PER_MESSAGE) {
              throw new Error(
                `Grupo tem ${recipients.length} participantes resolviveis (limite ${MAX_MENTIONS_PER_MESSAGE}). Reduza o publico ou desative o DM individual.`
              );
            }
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
                error_message: `Falha ao resolver participantes: ${errMsg}`,
                sent_by: user.id,
              });
            } catch {
              // ignore logging error
            }
            results.push({
              group: group.jid,
              name: group.name,
              sent: false,
              error: `Falha ao resolver participantes: ${errMsg}`,
            });
            continue;
          }

          let groupSent = 0;
          let groupFailed = 0;
          const groupErrors: string[] = [];
          for (const phone of recipients) {
            const recipientJid = `${phone}@s.whatsapp.net`;
            try {
              const r = await sendOne(
                recipientJid,
                message || "",
                caption || undefined
              );
              const ok = !r.error && !!r.messageId;
              const eMsg = r.error
                ? r.error
                : !r.messageId
                  ? "Sem messageId no retorno"
                  : null;
              try {
                await admin.from("wapi_group_messages").insert({
                  workspace_id: workspaceId,
                  dispatch_id: dispatch.id,
                  group_jid: group.jid,
                  group_name: group.name
                    ? `${group.name} -> ${phone}`
                    : phone,
                  message_type: messageType,
                  content: message || caption || null,
                  media_url: mediaUrl || null,
                  file_name: fileName || null,
                  status: ok ? "sent" : "failed",
                  error_message: eMsg,
                  sent_by: user.id,
                });
              } catch {
                // ignore logging error
              }
              if (ok) groupSent++;
              else {
                groupFailed++;
                if (eMsg) groupErrors.push(`${phone}: ${eMsg}`);
              }
            } catch (err) {
              const errMsg =
                err instanceof Error ? err.message : "Unknown error";
              groupFailed++;
              groupErrors.push(`${phone}: ${errMsg}`);
              try {
                await admin.from("wapi_group_messages").insert({
                  workspace_id: workspaceId,
                  dispatch_id: dispatch.id,
                  group_jid: group.jid,
                  group_name: group.name
                    ? `${group.name} -> ${phone}`
                    : phone,
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
            }
          }

          results.push({
            group: group.jid,
            name: group.name
              ? `${group.name} (DM x${recipients.length})`
              : `DM x${recipients.length}`,
            sent: groupSent > 0 && groupFailed === 0,
            error:
              groupFailed > 0
                ? `${groupFailed}/${recipients.length} DMs falharam${groupErrors.length ? `: ${groupErrors.slice(0, 3).join(" | ")}` : ""}`
                : undefined,
          });
          continue;
        }

        // ============================================================
        // Mode B (default): post one message into the group itself.
        // ============================================================
        const sendResult = await sendOne(
          group.jid,
          message || "",
          caption || undefined
        );

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
