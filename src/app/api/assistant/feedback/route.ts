// POST /api/assistant/feedback — 👍/👎 do cliente numa resposta do assistente.
//
// Segurança: o message_id sozinho NÃO basta — o chamador precisa provar posse
// da conversa via session_key (token não-adivinhável gerado pelo servidor).
// A mensagem tem que pertencer àquela conversa e ser role='assistant'.

import { NextRequest, NextResponse } from "next/server";
import { buildCorsHeaders } from "@/lib/cors";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";
import { hashIp } from "@/lib/assistant/guardrails";
import { checkIpRateLimit } from "@/lib/assistant/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 10;

function json(
  request: NextRequest,
  status: number,
  body: Record<string, unknown>
): NextResponse {
  return NextResponse.json(body, { status, headers: buildCorsHeaders(request) });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: { ...buildCorsHeaders(request), "Access-Control-Max-Age": "86400" },
  });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(request, 400, { ok: false });
  }

  const auth = await validateApiKey(typeof body.key === "string" ? body.key : null);
  if (!auth) return json(request, 401, { ok: false });

  // x-real-ip primeiro (setado pela Vercel, não-spoofável); o primeiro valor
  // do x-forwarded-for é controlado pelo cliente — usa o ÚLTIMO como fallback
  const ip =
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ||
    "unknown";
  if (!checkIpRateLimit(hashIp(ip))) return json(request, 429, { ok: false });

  const sessionKey =
    typeof body.session_id === "string" && /^[\w-]{16,64}$/.test(body.session_id)
      ? body.session_id
      : null;
  const messageId = Number(body.message_id);
  const rating = body.rating === 1 || body.rating === -1 ? body.rating : null;

  if (!sessionKey || !Number.isInteger(messageId) || messageId <= 0 || rating === null) {
    return json(request, 400, { ok: false });
  }

  const admin = createAdminClient();

  // Prova de posse: a sessão precisa existir neste workspace...
  const { data: conv } = await admin
    .from("assistant_conversations")
    .select("id")
    .eq("workspace_id", auth.workspaceId)
    .eq("session_key", sessionKey)
    .maybeSingle();
  if (!conv) return json(request, 404, { ok: false });

  // ...e a mensagem precisa ser DESTA conversa e ser resposta do assistente
  const { error } = await admin
    .from("assistant_messages")
    .update({ feedback: rating })
    .eq("id", messageId)
    .eq("conversation_id", conv.id as string)
    .eq("role", "assistant");

  if (error) {
    // Coluna ainda não existe (migration-129 pendente) → não quebra o widget
    console.warn("[assistant/feedback] update falhou:", error.message);
    return json(request, 200, { ok: false });
  }

  return json(request, 200, { ok: true });
}
