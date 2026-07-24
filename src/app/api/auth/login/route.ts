import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { AuthError, assertTrustedMutationOrigin } from "@/lib/api-auth";
import {
  consumeAuthRateLimits,
  normalizeAuthEmail,
} from "@/lib/security/auth-rate-limit";
import {
  createSupabaseAuthFetch,
  getSupabaseAuthConfig,
} from "@/lib/security/supabase-auth";
import { readLimitedJson } from "@/lib/security/webhook-request";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 8 * 1024;
const GENERIC_LOGIN_ERROR = "E-mail ou senha incorretos.";

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      ...headers,
    },
  });
}

function isProviderRateLimit(error: { status?: number; code?: string }): boolean {
  return (
    error.status === 429 ||
    error.code === "over_request_rate_limit" ||
    error.code === "over_email_send_rate_limit"
  );
}

function isProviderUnavailable(error: {
  status?: number;
  name?: string;
  code?: string;
}): boolean {
  return (
    error.status === 0 ||
    (error.status ?? 0) >= 500 ||
    error.name === "AuthRetryableFetchError" ||
    error.code === "unexpected_failure"
  );
}

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutationOrigin(request);

    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return jsonResponse({ error: "Solicitação inválida." }, 415);
    }

    const parsed = await readLimitedJson(request, MAX_BODY_BYTES);
    if (!parsed.ok) {
      return jsonResponse({ error: "Solicitação inválida." }, parsed.status);
    }

    const body =
      parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
        ? (parsed.value as Record<string, unknown>)
        : {};
    const email = normalizeAuthEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || password.length < 1 || password.length > 1024) {
      return jsonResponse({ error: GENERIC_LOGIN_ERROR }, 400);
    }

    const authConfig = getSupabaseAuthConfig();
    if (!authConfig) {
      return jsonResponse(
        { error: "Não foi possível entrar agora. Tente novamente em instantes." },
        503
      );
    }

    const rateLimit = await consumeAuthRateLimits(request, "login", email);
    if (!rateLimit.allowed) {
      return jsonResponse(
        {
          error: "Muitas tentativas. Aguarde e tente novamente.",
          retry_after: rateLimit.retryAfterSeconds,
        },
        429,
        {
          ...rateLimit.headers,
          "Retry-After": String(rateLimit.retryAfterSeconds),
        }
      );
    }

    const successResponse = jsonResponse({ ok: true }, 200, rateLimit.headers);
    const supabase = createServerClient(
      authConfig.url,
      authConfig.anonKey,
      {
        global: {
          fetch: createSupabaseAuthFetch(request.signal),
        },
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              successResponse.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) return successResponse;

    if (isProviderRateLimit(error)) {
      return jsonResponse(
        {
          error: "Muitas tentativas. Aguarde e tente novamente.",
          retry_after: 60,
        },
        429,
        { "Retry-After": "60" }
      );
    }

    if (isProviderUnavailable(error)) {
      console.warn("[auth-login] Supabase indisponível", {
        status: error.status,
        code: error.code,
      });
      return jsonResponse(
        { error: "Não foi possível entrar agora. Tente novamente em instantes." },
        503
      );
    }

    return jsonResponse({ error: GENERIC_LOGIN_ERROR }, 401);
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse({ error: "Solicitação não autorizada." }, error.status);
    }
    console.error(
      "[auth-login] Falha inesperada:",
      error instanceof Error ? error.message : "erro desconhecido"
    );
    return jsonResponse(
      { error: "Não foi possível entrar agora. Tente novamente em instantes." },
      503
    );
  }
}
