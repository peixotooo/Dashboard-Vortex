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
  WapiMessageType,
} from "@/lib/wapi-api";

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
    } = body as {
      groups: Array<{ jid: string; name?: string }>;
      messageType: WapiMessageType;
      message?: string;
      caption?: string;
      mediaUrl?: string;
      fileName?: string;
      extension?: string;
      delayMessage?: number;
    };

    if (!groups || groups.length === 0) {
      return NextResponse.json(
        { error: "No groups selected" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const results: Array<{
      group: string;
      name?: string;
      sent: boolean;
      error?: string;
    }> = [];
    const delay = delayMessage ?? 1;

    for (const group of groups) {
      try {
        let sendResult;

        switch (messageType) {
          case "text":
            sendResult = await sendText(
              config,
              group.jid,
              message || "",
              delay
            );
            break;
          case "image":
            sendResult = await sendImage(
              config,
              group.jid,
              mediaUrl || "",
              caption,
              delay
            );
            break;
          case "video":
            sendResult = await sendVideo(
              config,
              group.jid,
              mediaUrl || "",
              caption,
              delay
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
              caption,
              delay
            );
            break;
          default:
            throw new Error(`Unknown message type: ${messageType}`);
        }

        const sent = !sendResult.error;

        await admin.from("wapi_group_messages").insert({
          workspace_id: workspaceId,
          group_jid: group.jid,
          group_name: group.name || null,
          message_type: messageType,
          content: message || caption || null,
          media_url: mediaUrl || null,
          file_name: fileName || null,
          status: sent ? "sent" : "failed",
          error_message: sendResult.error || null,
          sent_by: user.id,
        });

        results.push({
          group: group.jid,
          name: group.name,
          sent,
          error: sendResult.error,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";

        try {
          await admin.from("wapi_group_messages").insert({
            workspace_id: workspaceId,
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

        results.push({ group: group.jid, name: group.name, sent: false, error: errMsg });
      }
    }

    const sentCount = results.filter((r) => r.sent).length;

    return NextResponse.json({
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
