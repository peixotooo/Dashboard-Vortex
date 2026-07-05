// Rotas ADMIN do assistente (autenticadas, dashboard):
//   GET  /api/assistant/admin            → settings + conversas recentes
//   PUT  /api/assistant/admin            → upsert settings
//   GET  /api/assistant/admin?conversation_id=... → transcrição completa

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { buildAssistantDashboard } from "@/lib/assistant/dashboard";
import { getDailyMessageCount } from "@/lib/assistant/rate-limit";

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const admin = createAdminClient();
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get("conversation_id");

    if (conversationId) {
      const { data: conv } = await admin
        .from("assistant_conversations")
        .select("id, product_id, page_url, message_count, created_at, last_message_at")
        .eq("workspace_id", workspaceId)
        .eq("id", conversationId)
        .maybeSingle();
      if (!conv) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      // select("*") pra incluir feedback sem quebrar se a migration-129
      // ainda não tiver sido aplicada (coluna ausente vira undefined)
      const { data: messages } = await admin
        .from("assistant_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .eq("workspace_id", workspaceId)
        .order("id", { ascending: true })
        .limit(200);
      return NextResponse.json({ conversation: conv, messages: messages || [] });
    }

    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [settingsRes, convsRes, convs7dRes, msgs7dRes, fbUpRes, fbDownRes] =
      await Promise.all([
        admin
          .from("assistant_settings")
          .select("*")
          .eq("workspace_id", workspaceId)
          .maybeSingle(),
        admin
          .from("assistant_conversations")
          .select("id, product_id, page_url, message_count, created_at, last_message_at, customer_name")
          .eq("workspace_id", workspaceId)
          .order("last_message_at", { ascending: false })
          .limit(50),
        admin
          .from("assistant_conversations")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .gte("created_at", since7d),
        admin
          .from("assistant_messages")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .eq("role", "user")
          .gte("created_at", since7d),
        admin
          .from("assistant_messages")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .eq("feedback", 1)
          .gte("created_at", since7d),
        admin
          .from("assistant_messages")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .eq("feedback", -1)
          .gte("created_at", since7d),
      ]);

    // Contagens de feedback falham sem a migration-129 (coluna feedback) —
    // devolve 0 em vez de quebrar o dashboard.
    const metrics = {
      conversations_7d: convs7dRes.count || 0,
      user_messages_7d: msgs7dRes.count || 0,
      feedback_up_7d: fbUpRes.error ? 0 : fbUpRes.count || 0,
      feedback_down_7d: fbDownRes.error ? 0 : fbDownRes.count || 0,
    };

    // Agregados completos do dashboard (série diária, intenções, top produtos,
    // horários, fila de 👎). Best-effort: falhou → página cai nos `metrics`.
    const dailyCap = Number(settingsRes.data?.daily_message_cap) || 1500;
    let dashboard = null;
    try {
      const messagesToday = await getDailyMessageCount(workspaceId);
      dashboard = await buildAssistantDashboard(admin, workspaceId, dailyCap, messagesToday);
    } catch (err) {
      console.warn(
        "[assistant/admin] dashboard aggregates failed:",
        err instanceof Error ? err.message : err
      );
    }

    return NextResponse.json({
      settings: settingsRes.data || null,
      conversations: convsRes.data || [],
      metrics,
      dashboard,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { workspaceId, userId } = await getWorkspaceContext(request);
    const body = (await request.json()) as Record<string, unknown>;
    const admin = createAdminClient();

    // Alinha com a RLS ("Admins manage assistant_settings"): member comum não
    // pode ligar/desligar, mudar modelo nem subir o cap diário de custo.
    const { data: membership } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership || !["owner", "admin"].includes(String(membership.role))) {
      return NextResponse.json(
        { error: "Apenas owner/admin podem alterar o assistente" },
        { status: 403 }
      );
    }

    // Whitelist de campos editáveis — nada além disso entra no banco
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.enabled === "boolean") update.enabled = body.enabled;
    if (typeof body.ask_name === "boolean") update.ask_name = body.ask_name;
    if (Array.isArray(body.product_ids)) {
      update.product_ids = body.product_ids
        .filter((p) => typeof p === "string" && /^(\*|[\w-]{1,40})$/.test(p))
        .slice(0, 200);
    }
    if (typeof body.model === "string") update.model = body.model.slice(0, 100) || null;
    if (typeof body.title === "string" && body.title.trim())
      update.title = body.title.slice(0, 60);
    if (typeof body.welcome_message === "string" && body.welcome_message.trim())
      update.welcome_message = body.welcome_message.slice(0, 300);
    if (Array.isArray(body.suggestions)) {
      update.suggestions = body.suggestions
        .filter((s) => typeof s === "string" && s.trim())
        .map((s) => (s as string).slice(0, 80))
        .slice(0, 4);
    }
    // Chat Commerce v2 (modo global / página /chat)
    if (typeof body.global_enabled === "boolean") update.global_enabled = body.global_enabled;
    if (typeof body.global_welcome === "string")
      update.global_welcome = body.global_welcome.slice(0, 400);
    if (Array.isArray(body.global_suggestions)) {
      update.global_suggestions = body.global_suggestions
        .filter((s) => typeof s === "string" && s.trim())
        .map((s) => (s as string).slice(0, 80))
        .slice(0, 6);
    }
    if (typeof body.store_info === "string")
      update.store_info = body.store_info.slice(0, 4000);
    if (typeof body.institutional_kb === "string")
      update.institutional_kb = body.institutional_kb.slice(0, 20000);
    if (
      typeof body.max_messages_per_session === "number" &&
      body.max_messages_per_session >= 1 &&
      body.max_messages_per_session <= 200
    )
      update.max_messages_per_session = Math.floor(body.max_messages_per_session);
    if (
      typeof body.daily_message_cap === "number" &&
      body.daily_message_cap >= 10 &&
      body.daily_message_cap <= 50000
    )
      update.daily_message_cap = Math.floor(body.daily_message_cap);

    const { data, error } = await admin
      .from("assistant_settings")
      .upsert({ workspace_id: workspaceId, ...update }, { onConflict: "workspace_id" })
      .select("*")
      .single();

    if (error) {
      console.error("[assistant/admin] upsert failed:", error.message);
      return NextResponse.json({ error: "save failed" }, { status: 500 });
    }
    return NextResponse.json({ settings: data });
  } catch (error) {
    return handleAuthError(error);
  }
}
