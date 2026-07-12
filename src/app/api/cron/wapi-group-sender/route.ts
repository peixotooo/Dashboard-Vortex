import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getWapiConfig,
  sendWapiMessage,
  checkInstanceHealth,
} from "@/lib/wapi-api";
import {
  isWapiMessageType,
  normalizeWapiMessagePayload,
  type WapiMessagePayload,
} from "@/lib/whatsapp/wapi-message-types";

export const maxDuration = 120;
const STALE_SENDING_MS = 2 * 60 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function payloadFromDispatch(
  dispatch: Record<string, unknown>,
): WapiMessagePayload {
  const stored = dispatch.payload;
  if (
    stored &&
    typeof stored === "object" &&
    !Array.isArray(stored) &&
    Object.keys(stored).length > 0
  ) {
    return stored as WapiMessagePayload;
  }

  // Disparos criados antes da migration-139 continuam funcionando.
  switch (dispatch.message_type) {
    case "text":
      return { message: dispatch.content || "" };
    case "image":
      return {
        image: dispatch.media_url || "",
        caption: dispatch.content || undefined,
      };
    case "video":
      return {
        video: dispatch.media_url || "",
        caption: dispatch.content || undefined,
      };
    case "audio":
      return { audio: dispatch.media_url || "" };
    case "document":
      return {
        document: dispatch.media_url || "",
        extension: dispatch.file_extension || "pdf",
        fileName: dispatch.file_name || undefined,
        caption: dispatch.content || undefined,
      };
    default:
      return {};
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    const staleCutoff = new Date(Date.now() - STALE_SENDING_MS).toISOString();
    const { data: staleDispatches } = await admin
      .from("wapi_group_dispatches")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
      })
      .eq("status", "sending")
      .lt("started_at", staleCutoff)
      .is("completed_at", null)
      .select("id");
    const recoveredStale = staleDispatches?.length || 0;

    const { data: dispatches } = await admin
      .from("wapi_group_dispatches")
      .select("*")
      .or("status.eq.queued,and(status.eq.scheduled,scheduled_at.lte.now())")
      .limit(3);

    if (!dispatches || dispatches.length === 0) {
      return NextResponse.json({
        processed: 0,
        recovered_stale: recoveredStale,
      });
    }

    let totalProcessed = 0;

    for (const dispatch of dispatches) {
      const config = await getWapiConfig(dispatch.workspace_id);
      if (!config) {
        await admin
          .from("wapi_group_dispatches")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", dispatch.id);
        continue;
      }

      // Pre-flight: only flip to "sending" once we know the session is
      // genuinely usable. If the W-API instance is half-broken, dispatching
      // would silently queue messages on their side and burst on reconnect.
      // We leave the dispatch in its current status (queued/scheduled) so
      // the next cron tick retries automatically once the session recovers.
      const health = await checkInstanceHealth(config);
      if (!health.healthy) {
        console.warn(
          `[WAPI Group Sender] Skipping dispatch ${dispatch.id}: ${health.reason}`,
        );
        continue;
      }

      await admin
        .from("wapi_group_dispatches")
        .update({
          status: "sending",
          started_at: new Date().toISOString(),
        })
        .eq("id", dispatch.id);

      const groups = (dispatch.target_groups || []) as Array<{
        jid: string;
        name: string | null;
      }>;
      let sentCount = 0;
      let failedCount = 0;

      for (const group of groups) {
        try {
          let result;
          const delaySeconds = dispatch.delay_seconds || 1;

          if (!isWapiMessageType(dispatch.message_type)) {
            throw new Error(`Unknown message type: ${dispatch.message_type}`);
          }
          const payload = normalizeWapiMessagePayload(
            dispatch.message_type,
            payloadFromDispatch(dispatch),
          );
          result = await sendWapiMessage(
            config,
            dispatch.message_type,
            group.jid,
            payload,
            delaySeconds,
          );

          const sent = !result.error && !!result.messageId;
          const errMsg = result.error
            ? result.error
            : !result.messageId
              ? "W-API aceitou a chamada mas nao retornou messageId (mensagem provavelmente nao foi entregue)"
              : null;

          try {
            await admin.from("wapi_group_messages").insert({
              workspace_id: dispatch.workspace_id,
              dispatch_id: dispatch.id,
              group_jid: group.jid,
              group_name: group.name || null,
              message_type: dispatch.message_type,
              content: dispatch.content || null,
              media_url: dispatch.media_url || null,
              file_name: dispatch.file_name || null,
              status: sent ? "sent" : "failed",
              error_message: errMsg,
              sent_by: dispatch.sent_by,
            });
          } catch {
            // ignore logging error
          }

          if (sent) sentCount++;
          else failedCount++;
        } catch (err) {
          failedCount++;
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          try {
            await admin.from("wapi_group_messages").insert({
              workspace_id: dispatch.workspace_id,
              dispatch_id: dispatch.id,
              group_jid: group.jid,
              group_name: group.name || null,
              message_type: dispatch.message_type,
              content: dispatch.content || null,
              media_url: dispatch.media_url || null,
              file_name: dispatch.file_name || null,
              status: "failed",
              error_message: errMsg,
              sent_by: dispatch.sent_by,
            });
          } catch {
            // ignore logging error
          }
        }

        if (dispatch.delay_seconds > 0) {
          await sleep(dispatch.delay_seconds * 1000);
        }
      }

      await admin
        .from("wapi_group_dispatches")
        .update({
          status: "completed",
          sent_count: sentCount,
          failed_count: failedCount,
          completed_at: new Date().toISOString(),
        })
        .eq("id", dispatch.id);

      totalProcessed += sentCount + failedCount;

      console.log(
        `[WAPI Group Sender] Dispatch ${dispatch.id}: sent=${sentCount} failed=${failedCount}`,
      );
    }

    return NextResponse.json({
      processed: totalProcessed,
      recovered_stale: recoveredStale,
    });
  } catch (error) {
    console.error(
      "[WAPI Group Sender]",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
