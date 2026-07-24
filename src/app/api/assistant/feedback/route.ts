// POST /api/assistant/feedback — 👍/👎 do cliente numa resposta do assistente.
//
// Segurança: o message_id sozinho NÃO basta — o chamador precisa provar posse
// da conversa via session_key (token não-adivinhável gerado pelo servidor).
// A mensagem tem que pertencer àquela conversa e ser role='assistant'.

import { NextRequest, NextResponse } from "next/server";
import { getStorefrontCors } from "@/lib/cors";
import { validateApiKey } from "@/lib/shelves/api-key";
import { createAdminClient } from "@/lib/supabase-admin";
import { hashIp } from "@/lib/assistant/guardrails";
import { checkIpRateLimit } from "@/lib/assistant/rate-limit";
import { getRequestClientIp } from "@/lib/security/rate-limit";
import { readLimitedJson } from "@/lib/security/webhook-request";

export const runtime = "nodejs";
export const maxDuration = 10;
const MAX_BODY_BYTES = 8 * 1024;

function json(
  headers: Record<string, string>,
  status: number,
  body: Record<string, unknown>
): NextResponse {
  return NextResponse.json(body, { status, headers });
}

export async function OPTIONS(request: NextRequest) {
  const cors = await getStorefrontCors(request);
  return new NextResponse(null, {
    status: cors.allowed ? 204 : 403,
    headers: { ...cors.headers, "Access-Control-Max-Age": "86400" },
  });
}

export async function POST(request: NextRequest) {
  let corsResult = await getStorefrontCors(request);
  let cors = corsResult.headers;
  if (!corsResult.allowed) {
    return json(cors, 403, { ok: false });
  }

  const parsed = await readLimitedJson(request, MAX_BODY_BYTES);
  if (!parsed.ok) return json(cors, parsed.status, { ok: false });
  const body =
    parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
      ? (parsed.value as Record<string, unknown>)
      : {};

  const auth = await validateApiKey(typeof body.key === "string" ? body.key : null);
  if (!auth) return json(cors, 401, { ok: false });

  corsResult = await getStorefrontCors(request, auth.workspaceId);
  cors = corsResult.headers;
  if (!corsResult.allowed) return json(cors, 403, { ok: false });

  const ip = getRequestClientIp(request);
  if (!(await checkIpRateLimit(hashIp(ip)))) {
    return json(cors, 429, { ok: false });
  }

  const sessionKey =
    typeof body.session_id === "string" && /^[\w-]{16,64}$/.test(body.session_id)
      ? body.session_id
      : null;
  const messageId = Number(body.message_id);
  const rating = body.rating === 1 || body.rating === -1 ? body.rating : null;

  if (!sessionKey || !Number.isInteger(messageId) || messageId <= 0 || rating === null) {
    return json(cors, 400, { ok: false });
  }

  const admin = createAdminClient();

  // Prova de posse: a sessão precisa existir neste workspace...
  const { data: conv } = await admin
    .from("assistant_conversations")
    .select("id")
    .eq("workspace_id", auth.workspaceId)
    .eq("session_key", sessionKey)
    .maybeSingle();
  if (!conv) return json(cors, 404, { ok: false });

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
    return json(cors, 200, { ok: false });
  }

  return json(cors, 200, { ok: true });
}
