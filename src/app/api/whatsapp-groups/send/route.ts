import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWapiConfig, WapiMessageType } from "@/lib/wapi-api";

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
      save_as_draft,
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
      save_as_draft?: boolean;
    };

    if (!groups || groups.length === 0) {
      return NextResponse.json(
        { error: "No groups selected" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const delay = delayMessage ?? 1;

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
        content: message || caption || null,
        media_url: mediaUrl || null,
        file_name: fileName || null,
        file_extension: extension || null,
        delay_seconds: delay,
        status: initialStatus,
        // Pra draft, persistimos scheduled_at mesmo se já passou — usuário
        // pode editar depois ou simplesmente ativar pra envio imediato.
        scheduled_at: initialStatus === "queued" ? null : scheduled_at || null,
        started_at: null,
        target_groups: groups.map((g) => ({
          jid: g.jid,
          name: g.name || null,
        })),
        total_groups: groups.length,
        sent_by: user.id,
      })
      .select("id")
      .single();

    if (dispatchError || !dispatch) {
      return NextResponse.json(
        { error: "Failed to create dispatch" },
        { status: 500 }
      );
    }

    // Rascunho ou agendamento: retorna agora, cron ou ativação cuidam depois.
    if (isDraft) {
      return NextResponse.json({
        dispatch_id: dispatch.id,
        status: "draft",
        scheduled_at: scheduled_at || null,
        total: groups.length,
      });
    }
    if (isScheduled) {
      return NextResponse.json({
        dispatch_id: dispatch.id,
        status: "scheduled",
        scheduled_at,
        total: groups.length,
      });
    }

    return NextResponse.json({
      dispatch_id: dispatch.id,
      status: "queued",
      queued: true,
      total: groups.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
