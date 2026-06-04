import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  addEmailSuppression,
  normalizeEmailAddress,
  verifyUnsubscribeToken,
} from "@/lib/email-unsubscribe";

export const runtime = "nodejs";
export const maxDuration = 10;

function htmlResponse(body: string, status = 200): NextResponse {
  return new NextResponse(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Descadastro de email</title>
  <style>
    body{margin:0;font-family:Arial,sans-serif;background:#f6f6f6;color:#111;display:grid;min-height:100vh;place-items:center}
    main{max-width:520px;background:#fff;padding:32px;border:1px solid #e5e5e5}
    h1{font-size:24px;margin:0 0 12px}
    p{font-size:15px;line-height:1.55;color:#444;margin:0}
  </style>
</head>
<body><main>${body}</main></body>
</html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function readParams(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return {
    workspaceId: params.get("w") || "",
    email: normalizeEmailAddress(params.get("e") || ""),
    source: params.get("s") || "email",
    token: params.get("t") || "",
  };
}

async function unsubscribe(request: NextRequest, oneClick: boolean) {
  const { workspaceId, email, source, token } = readParams(request);
  if (!workspaceId || !email || !token) {
    return oneClick
      ? NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 })
      : htmlResponse("<h1>Link invalido</h1><p>Este link de descadastro esta incompleto.</p>", 400);
  }

  const valid = verifyUnsubscribeToken({ workspaceId, email, source, token });
  if (!valid) {
    return oneClick
      ? NextResponse.json({ ok: false, error: "invalid_token" }, { status: 403 })
      : htmlResponse("<h1>Link expirado ou invalido</h1><p>Por seguranca, confira se voce abriu o link completo do email.</p>", 403);
  }

  if (!oneClick) {
    const action = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    return htmlResponse(`<h1>Descadastrar email?</h1>
<p>Confirme para parar de receber lembretes por email deste workspace em <strong>${email}</strong>.</p>
<form method="post" action="${action}" style="margin-top:20px">
  <button type="submit" style="background:#111;color:#fff;border:0;padding:12px 18px;font-size:14px;cursor:pointer">Confirmar descadastro</button>
</form>`);
  }

  const admin = createAdminClient();
  const result = await addEmailSuppression(admin, {
    workspaceId,
    email,
    source,
    reason: "unsubscribe",
    userAgent: request.headers.get("user-agent"),
  });

  if (!result.ok) {
    return oneClick
      ? NextResponse.json({ ok: false, error: result.error || "save_failed" }, { status: 500 })
      : htmlResponse("<h1>Nao consegui concluir agora</h1><p>Tente novamente em alguns minutos.</p>", 500);
  }

  if (oneClick) return NextResponse.json({ ok: true });
  return htmlResponse("<h1>Descadastro confirmado</h1><p>Voce nao recebera mais lembretes por email deste workspace.</p>");
}

export async function GET(request: NextRequest) {
  return unsubscribe(request, false);
}

export async function POST(request: NextRequest) {
  return unsubscribe(request, true);
}
