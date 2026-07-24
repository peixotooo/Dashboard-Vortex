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
const GENERIC_RECOVERY_MESSAGE =
  "Se o e-mail estiver cadastrado, você receberá um link de recuperação em instantes.";

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

function isAllowedOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

function recoveryRedirectUrl(request: NextRequest): string {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL || "",
    process.env.APP_URL || "",
    request.nextUrl.origin,
    "https://dashboard-vortex.vercel.app",
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "",
  ];
  const origin = candidates.find((candidate) => candidate && isAllowedOrigin(candidate));
  return new URL(
    "/auth/callback?type=recovery",
    origin || "https://dashboard-vortex.vercel.app"
  ).toString();
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
    if (!email) {
      return jsonResponse({ error: "Informe um e-mail válido." }, 400);
    }

    const authConfig = getSupabaseAuthConfig();
    if (!authConfig) {
      return jsonResponse(
        { error: "Não foi possível processar a solicitação agora." },
        503
      );
    }

    const rateLimit = await consumeAuthRateLimits(request, "recover", email);
    if (!rateLimit.allowed) {
      return jsonResponse(
        {
          error: "Muitas solicitações. Aguarde e tente novamente.",
          retry_after: rateLimit.retryAfterSeconds,
        },
        429,
        {
          ...rateLimit.headers,
          "Retry-After": String(rateLimit.retryAfterSeconds),
        }
      );
    }

    const supabase = createServerClient(
      authConfig.url,
      authConfig.anonKey,
      {
        global: {
          fetch: createSupabaseAuthFetch(request.signal),
        },
        cookies: {
          getAll() {
            return [];
          },
          setAll() {
            // Password recovery does not create a browser session.
          },
        },
      }
    );

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: recoveryRedirectUrl(request),
    });
    if (error) {
      console.warn("[auth-recover] Solicitação não enviada pelo Supabase", {
        status: error.status,
        code: error.code,
      });
    }

    // Do not reveal whether an account exists or whether Supabase sent an email.
    return jsonResponse(
      { ok: true, message: GENERIC_RECOVERY_MESSAGE },
      200,
      rateLimit.headers
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse({ error: "Solicitação não autorizada." }, error.status);
    }
    console.error(
      "[auth-recover] Falha inesperada:",
      error instanceof Error ? error.message : "erro desconhecido"
    );
    return jsonResponse(
      { error: "Não foi possível processar a solicitação agora." },
      503
    );
  }
}
