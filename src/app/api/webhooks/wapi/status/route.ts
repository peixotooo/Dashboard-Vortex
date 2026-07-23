import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

type WapiWebhookBody = {
  event?: unknown;
  instanceId?: unknown;
  connectedPhone?: unknown;
  isGroup?: unknown;
  messageId?: unknown;
  fromApi?: unknown;
  chat?: { id?: unknown };
  status?: unknown;
  error?: unknown;
  message?: unknown;
  msgContent?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as WapiWebhookBody;
    const instanceId =
      typeof body.instanceId === "string" ? body.instanceId.trim() : "";
    if (!instanceId) {
      return NextResponse.json({ error: "Missing instanceId" }, { status: 400 });
    }

    // A W-API nao assina os webhooks. Aceitamos eventos somente da instancia
    // cadastrada no dashboard, evitando que payloads de instancias aleatorias
    // contaminem nossos diagnosticos de entrega.
    const admin = createAdminClient();
    const { data: config } = await admin
      .from("wapi_config")
      .select("workspace_id")
      .eq("instance_id", instanceId)
      .maybeSingle();
    if (!config) {
      return NextResponse.json({ error: "Unknown instance" }, { status: 403 });
    }

    const contentTypes =
      body.msgContent &&
      typeof body.msgContent === "object" &&
      !Array.isArray(body.msgContent)
        ? Object.keys(body.msgContent as Record<string, unknown>).slice(0, 10)
        : [];

    console.info(
      "[WAPI Delivery]",
      JSON.stringify({
        workspaceId: config.workspace_id,
        event: body.event ?? null,
        instanceId,
        messageId: body.messageId ?? null,
        chatId: body.chat?.id ?? null,
        isGroup: body.isGroup ?? null,
        fromApi: body.fromApi ?? null,
        status: body.status ?? null,
        error: body.error ?? body.message ?? null,
        contentTypes,
      }),
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "[WAPI Delivery] Invalid webhook",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ ok: true });
  }
}
