import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getWapiConfig,
  sendText,
  sendImage,
  sendVideo,
  sendAudio,
  sendDocument,
} from "@/lib/wapi-api";

export const maxDuration = 120;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    const { data: dispatches } = await admin
      .from("wapi_group_dispatches")
      .select("*")
      .or(
        "status.eq.queued,and(status.eq.scheduled,scheduled_at.lte.now())"
      )
      .limit(3);

    if (!dispatches || dispatches.length === 0) {
      return NextResponse.json({ processed: 0 });
    }

    let totalProcessed = 0;

    for (const dispatch of dispatches) {
      await admin
        .from("wapi_group_dispatches")
        .update({
          status: "sending",
          started_at: new Date().toISOString(),
        })
        .eq("id", dispatch.id);

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

      const groups = (dispatch.target_groups || []) as Array<{
        jid: string;
        name: string | null;
      }>;
      let sentCount = 0;
      let failedCount = 0;

      for (const group of groups) {
        try {
          let result;
          const content = dispatch.content || "";
          const mediaUrl = dispatch.media_url || "";
          const delaySeconds = dispatch.delay_seconds || 1;

          switch (dispatch.message_type) {
            case "text":
              result = await sendText(config, group.jid, content, delaySeconds);
              break;
            case "image":
              result = await sendImage(
                config,
                group.jid,
                mediaUrl,
                content || undefined,
                delaySeconds
              );
              break;
            case "video":
              result = await sendVideo(
                config,
                group.jid,
                mediaUrl,
                content || undefined,
                delaySeconds
              );
              break;
            case "audio":
              result = await sendAudio(
                config,
                group.jid,
                mediaUrl,
                delaySeconds
              );
              break;
            case "document":
              result = await sendDocument(
                config,
                group.jid,
                mediaUrl,
                dispatch.file_extension || "pdf",
                dispatch.file_name || undefined,
                content || undefined,
                delaySeconds
              );
              break;
            default:
              throw new Error(
                `Unknown message type: ${dispatch.message_type}`
              );
          }

          const sent = !result.error;

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
              error_message: result.error || null,
              sent_by: dispatch.sent_by,
            });
          } catch {
            // ignore logging error
          }

          if (sent) sentCount++;
          else failedCount++;
        } catch (err) {
          failedCount++;
          const errMsg =
            err instanceof Error ? err.message : "Unknown error";
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
        `[WAPI Group Sender] Dispatch ${dispatch.id}: sent=${sentCount} failed=${failedCount}`
      );
    }

    return NextResponse.json({ processed: totalProcessed });
  } catch (error) {
    console.error(
      "[WAPI Group Sender]",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
