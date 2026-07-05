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
  /** Chat Commerce v2: página /chat global (vende a loja toda). */
  global?: unknown;
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

  // Modo global (Chat Commerce v2): só vale se o workspace habilitou. Nesse
  // modo não há produto de página e o gate por produto é dispensado.
  const wantsGlobal = body.global === true && settings.globalEnabled;

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

  // 5. Cap diário de custo — SEPARADO por superfície: uma rajada no chat global
  // (v2) não pode estourar a cota e derrubar o widget de PDP (v1). Cada um tem
  // seu próprio teto diário.
  const capSurface: "pdp" | "global" = wantsGlobal ? "global" : "pdp";
  const dailyCount = await getDailyMessageCount(workspaceId, capSurface);
  if (dailyCount >= settings.dailyMessageCap) {
    return json(request, 429, { ok: false, reply: BUSY_REPLY });
  }

  // 6. Sessão: carrega existente ou cria (criação exige produto liberado)
  let conversationId: string;
  let activeSessionKey: string;
  let messageCount = 0;
  // Superfície da conversa: fixada na criação e mantida por toda a sessão.
  let surface: "pdp" | "global" = wantsGlobal ? "global" : "pdp";

  let activeName: string | null = customerName;
  let isNewSession = false;
  // Índice durável de produtos mostrados na sessão (IDs pro carrinho). Coluna
  // recent_products pode não existir se migration-133 pendente → cai em [].
  let recentProducts: Array<{ id: string; name: string; sizes?: string[] }> = [];

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
    // Superfície vem da sessão (coluna surface pode não existir se migration-132
    // pendente → cai no default 'pdp', comportamento v1 seguro).
    if (conv.surface === "global") surface = "global";
    else if (conv.surface === "pdp") surface = "pdp";
    if (Array.isArray(conv.recent_products)) {
      recentProducts = (conv.recent_products as unknown[])
        .filter((p): p is { id: string; name: string; sizes?: string[] } =>
          Boolean(p && typeof p === "object" && (p as { id?: unknown }).id))
        .map((p) => ({
          id: String(p.id),
          name: String(p.name || ""),
          sizes: Array.isArray(p.sizes) ? p.sizes.map(String) : undefined,
        }))
        .slice(-20);
    }
  } else {
    // No modo global o gate por produto é dispensado (a página vende a loja
    // toda); fora dele, mantém o gate estrito do widget v1.
    if (!surface || surface === "pdp") {
      if (!isProductAllowed(settings, productId)) {
        return json(request, 403, { ok: false, error: "assistant not available here" });
      }
    }
    activeSessionKey = randomBytes(24).toString("base64url");
    const insertRow: Record<string, unknown> = {
      workspace_id: workspaceId,
      session_key: activeSessionKey,
      product_id: surface === "global" ? null : productId,
      page_url: pageUrl,
      ip_hash: ipHash,
      user_agent: (request.headers.get("user-agent") || "").slice(0, 250),
    };
    if (surface === "global") insertRow.surface = "global";
    const { data: created, error: createError } = await admin
      .from("assistant_conversations")
      .insert(insertRow)
      .select("id")
      .single();

    if (createError || !created) {
      return json(request, 500, { ok: false, reply: BUSY_REPLY });
    }
    conversationId = created.id as string;
    isNewSession = true;

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
      currentProductId: surface === "global" ? null : productId,
      customerName: activeName,
      surface,
      recentProducts,
    });
  } catch (err) {
    console.error("[assistant] turn failed:", err instanceof Error ? err.message : err);
    return json(request, 500, {
      ok: false,
      session_id: activeSessionKey,
      reply: "Tive um problema técnico agora. Tenta de novo em instantes.",
    });
  }

  // 10. Persiste transcrição (PII limpa) + telemetria de tools.
  // surface só é gravado no modo global (coluna da migration-132) — no v1 cai
  // no DEFAULT 'pdp' da coluna, então nada quebra se a migration não rodou.
  const surfaceCol = surface === "global" ? { surface: "global" } : {};
  const rows: Array<Record<string, unknown>> = [
    {
      conversation_id: conversationId,
      workspace_id: workspaceId,
      role: "user",
      content: scrubPiiForStorage(message),
      ...surfaceCol,
    },
    {
      conversation_id: conversationId,
      workspace_id: workspaceId,
      role: "assistant",
      // Scrub também a resposta: se o modelo repetir um dado que o cliente
      // digitou, não guardamos em claro na transcrição (LGPD).
      content: scrubPiiForStorage(result.reply),
      ...surfaceCol,
    },
  ];
  if (result.toolLog.length > 0) {
    rows.push({
      conversation_id: conversationId,
      workspace_id: workspaceId,
      role: "tool",
      // Scrub também na telemetria: o input de consultar_pedido carrega o
      // e-mail do cliente — mascara igual às mensagens (achado da revisão)
      content: scrubPiiForStorage(JSON.stringify(result.toolLog)).slice(0, 4000),
      ...surfaceCol,
    });
  }
  // Captura o id da resposta persistida — o widget usa pro feedback 👍/👎
  const { data: inserted } = await admin
    .from("assistant_messages")
    .insert(rows)
    .select("id, role");
  const assistantMessageId =
    (inserted || []).find((r) => r.role === "assistant")?.id ?? null;

  // Atualiza contador + índice de produtos mostrados. recent_products (migration
  // 133) é best-effort: se a coluna não existir, refaz o update sem ela pra não
  // perder a contagem de mensagens.
  const baseUpdate = {
    message_count: messageCount + 1,
    last_message_at: new Date().toISOString(),
  };
  const nextRecent = Array.isArray(result.recentProducts)
    ? result.recentProducts.slice(-20)
    : recentProducts;
  const { error: updErr } = await admin
    .from("assistant_conversations")
    .update({ ...baseUpdate, recent_products: nextRecent })
    .eq("id", conversationId);
  if (updErr) {
    await admin
      .from("assistant_conversations")
      .update(baseUpdate)
      .eq("id", conversationId);
  }

  // Telemetria de funil (server-side, autoritativa — à prova de adblock). Best-
  // effort: tabela pode não existir se migration-133 pendente → ignora o erro.
  try {
    const events: Array<Record<string, unknown>> = [];
    if (isNewSession) {
      events.push({
        workspace_id: workspaceId,
        atk: activeSessionKey,
        event_type: "session_started",
        surface,
        ip_hash: ipHash,
      });
    }
    events.push({
      workspace_id: workspaceId,
      atk: activeSessionKey,
      event_type: "message_sent",
      surface,
      ip_hash: ipHash,
      metadata: {
        msg_index: messageCount + 1,
        // Modelo usado no turno — mede a taxa de escalada haiku→sonnet (custo).
        ...(result.modelUsed ? { model: String(result.modelUsed).slice(0, 60) } : {}),
      },
    });
    // Produtos mostrados neste turno (cards + carrosséis) — mede a qualidade da
    // recomendação (a razão de existir do agente).
    const shownIds = new Set<string>();
    for (const p of result.products || []) if (p.id) shownIds.add(String(p.id));
    for (const b of result.blocks || []) {
      if (b.type === "products") for (const p of b.products) if (p.id) shownIds.add(String(p.id));
    }
    if (shownIds.size > 0) {
      events.push({
        workspace_id: workspaceId,
        atk: activeSessionKey,
        event_type: "products_shown",
        surface,
        ip_hash: ipHash,
        product_ids: [...shownIds].slice(0, 30),
        metadata: { count: shownIds.size },
      });
    }
    await admin.from("assistant_events").insert(events);
  } catch {
    // telemetria nunca quebra a resposta ao cliente
  }

  return json(request, 200, {
    ok: true,
    session_id: activeSessionKey,
    reply: result.reply,
    products: result.products,
    whatsapp: result.showWhatsapp,
    message_id: assistantMessageId,
    // Chat Commerce v2: blocos ricos ordenados (a página /chat usa; o widget ignora)
    blocks: result.blocks || [],
    // Widget PDP (v1): produto+tamanho pra adicionar à sacola da loja same-origin.
    cart_add: result.cartAdd || null,
  });
}
