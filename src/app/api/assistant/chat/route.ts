// POST /api/assistant/chat — endpoint público do widget de chat da loja.
//
// Segurança (nesta ordem, fail-closed):
//  1. API key pública (mesma shelf_api_keys do shelves.js) → workspace
//  2. Feature habilitada + produto liberado (gate por produto)
//  3. Rate limit por IP + teto por sessão + cap diário de custo
//  4. Histórico da conversa vive NO SERVIDOR — o cliente só envia a própria
//     mensagem; não consegue forjar system prompt nem mensagens do assistente
//  5. Resposta passa por sanitização antes de sair; PII é limpa antes de logar

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { buildCorsHeaders } from "@/lib/cors";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";
import { getVndaConfigAdmin } from "@/lib/vnda-api";
import { getAssistantSettings, isProductAllowed } from "@/lib/assistant/settings";
import {
  hashIp,
  scrubPiiForStorage,
  validateCustomerName,
  validateUserMessage,
} from "@/lib/assistant/guardrails";
import { checkIpRateLimit, getDailyMessageCount } from "@/lib/assistant/rate-limit";
import { runAssistantTurn } from "@/lib/assistant/harness";
import type { AssistantHistoryMessage } from "@/lib/assistant/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUSY_REPLY =
  "Estou recebendo muitas mensagens agora. Tenta de novo em um minuto.";
const SESSION_LIMIT_REPLY =
  "Chegamos ao limite desta conversa. Se ainda precisar de ajuda, fale com o atendimento oficial da loja.";

interface ChatBody {
  key?: unknown;
  session_id?: unknown;
  product_id?: unknown;
  page_url?: unknown;
  message?: unknown;
  customer_name?: unknown;
}

function json(
  request: NextRequest,
  status: number,
  body: Record<string, unknown>
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: buildCorsHeaders(request),
  });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...buildCorsHeaders(request),
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function POST(request: NextRequest) {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return json(request, 400, { ok: false, error: "invalid body" });
  }

  // 1. API key → workspace
  const auth = await validateApiKey(typeof body.key === "string" ? body.key : null);
  if (!auth) {
    return json(request, 401, { ok: false, error: "invalid key" });
  }
  const { workspaceId } = auth;

  // 2. Feature ligada?
  const settings = await getAssistantSettings(workspaceId);
  if (!settings.enabled) {
    return json(request, 403, { ok: false, error: "assistant disabled" });
  }

  // 3. Rate limit por IP (in-memory, best-effort por instância).
  // Na Vercel, x-real-ip é o IP real do cliente; o PRIMEIRO valor de
  // x-forwarded-for é spoofável (o cliente pode mandar o próprio header).
  const ip =
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ||
    "unknown";
  const ipHash = hashIp(ip);
  if (!checkIpRateLimit(ipHash)) {
    return json(request, 429, { ok: false, reply: BUSY_REPLY });
  }

  // 4. Mensagem válida?
  const message = validateUserMessage(body.message);
  if (!message) {
    return json(request, 400, { ok: false, error: "invalid message" });
  }

  const productId =
    typeof body.product_id === "string" && /^[\w-]{1,40}$/.test(body.product_id)
      ? body.product_id
      : null;
  const pageUrl =
    typeof body.page_url === "string" ? body.page_url.slice(0, 300) : null;
  const sessionKey =
    typeof body.session_id === "string" && /^[\w-]{16,64}$/.test(body.session_id)
      ? body.session_id
      : null;
  const customerName = validateCustomerName(body.customer_name);

  const admin = createAdminClient();

  // 5. Cap diário de custo do workspace — ANTES de criar sessão, pra um
  // abusador acima do cap não conseguir nem inserir linhas de conversa.
  const dailyCount = await getDailyMessageCount(workspaceId);
  if (dailyCount >= settings.dailyMessageCap) {
    return json(request, 429, { ok: false, reply: BUSY_REPLY });
  }

  // 6. Sessão: carrega existente ou cria (criação exige produto liberado)
  let conversationId: string;
  let activeSessionKey: string;
  let messageCount = 0;

  let activeName: string | null = customerName;

  if (sessionKey) {
    // select("*") pra não quebrar se customer_name ainda não existir (migration
    // 128 pendente) — coluna ausente vira undefined em vez de erro.
    const { data: conv } = await admin
      .from("assistant_conversations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("session_key", sessionKey)
      .maybeSingle();

    if (!conv) {
      return json(request, 404, { ok: false, error: "session not found" });
    }
    conversationId = conv.id as string;
    activeSessionKey = conv.session_key as string;
    messageCount = Number(conv.message_count) || 0;
    // Nome já capturado na sessão tem prioridade sobre o do payload
    activeName = (conv.customer_name as string | null) || customerName;
  } else {
    if (!isProductAllowed(settings, productId)) {
      return json(request, 403, { ok: false, error: "assistant not available here" });
    }
    activeSessionKey = randomBytes(24).toString("base64url");
    const { data: created, error: createError } = await admin
      .from("assistant_conversations")
      .insert({
        workspace_id: workspaceId,
        session_key: activeSessionKey,
        product_id: productId,
        page_url: pageUrl,
        ip_hash: ipHash,
        user_agent: (request.headers.get("user-agent") || "").slice(0, 250),
      })
      .select("id")
      .single();

    if (createError || !created) {
      return json(request, 500, { ok: false, reply: BUSY_REPLY });
    }
    conversationId = created.id as string;

    // Persiste o nome à parte (best-effort): se a coluna ainda não existir,
    // ignora — o nome do payload já vai pro prompt de qualquer forma.
    if (customerName) {
      const { error: nameError } = await admin
        .from("assistant_conversations")
        .update({ customer_name: customerName })
        .eq("id", conversationId);
      if (nameError) {
        console.warn("[assistant] customer_name não persistido:", nameError.message);
      }
    }
  }

  // 7. Teto por sessão
  if (messageCount >= settings.maxMessagesPerSession) {
    return json(request, 429, {
      ok: false,
      session_id: activeSessionKey,
      reply: SESSION_LIMIT_REPLY,
    });
  }

  // 8. Histórico do servidor (só user/assistant — tool rows são telemetria)
  const { data: historyRows } = await admin
    .from("assistant_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .in("role", ["user", "assistant"])
    .order("id", { ascending: true })
    .limit(40);

  const history: AssistantHistoryMessage[] = (historyRows || []).map((r) => ({
    role: r.role as "user" | "assistant",
    content: String(r.content),
  }));

  // 9. Roda o turno do agente
  let result;
  try {
    const vndaConfig = await getVndaConfigAdmin(workspaceId);
    result = await runAssistantTurn({
      workspaceId,
      settings,
      storeHost: vndaConfig?.storeHost || "a loja",
      history,
      userMessage: message,
      currentProductId: productId,
      customerName: activeName,
    });
  } catch (err) {
    console.error("[assistant] turn failed:", err instanceof Error ? err.message : err);
    return json(request, 500, {
      ok: false,
      session_id: activeSessionKey,
      reply: "Tive um problema técnico agora. Tenta de novo em instantes.",
    });
  }

  // 10. Persiste transcrição (PII limpa) + telemetria de tools
  const rows: Array<Record<string, unknown>> = [
    {
      conversation_id: conversationId,
      workspace_id: workspaceId,
      role: "user",
      content: scrubPiiForStorage(message),
    },
    {
      conversation_id: conversationId,
      workspace_id: workspaceId,
      role: "assistant",
      // Scrub também a resposta: se o modelo repetir um dado que o cliente
      // digitou, não guardamos em claro na transcrição (LGPD).
      content: scrubPiiForStorage(result.reply),
    },
  ];
  if (result.toolLog.length > 0) {
    rows.push({
      conversation_id: conversationId,
      workspace_id: workspaceId,
      role: "tool",
      content: JSON.stringify(result.toolLog).slice(0, 4000),
    });
  }
  // Captura o id da resposta persistida — o widget usa pro feedback 👍/👎
  const { data: inserted } = await admin
    .from("assistant_messages")
    .insert(rows)
    .select("id, role");
  const assistantMessageId =
    (inserted || []).find((r) => r.role === "assistant")?.id ?? null;

  await admin
    .from("assistant_conversations")
    .update({
      message_count: messageCount + 1,
      last_message_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  return json(request, 200, {
    ok: true,
    session_id: activeSessionKey,
    reply: result.reply,
    products: result.products,
    whatsapp: result.showWhatsapp,
    message_id: assistantMessageId,
  });
}
