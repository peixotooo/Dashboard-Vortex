import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  recordPoolRedirect,
  selectGroupForPoolRedirect,
} from "@/lib/whatsapp/group-pools";

function htmlResponse(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #0f1115; color: #f5f5f5; display: grid; min-height: 100vh; place-items: center; }
    main { width: min(92vw, 440px); text-align: center; }
    h1 { font-size: 24px; margin: 0 0 12px; }
    p { color: #c9c9d1; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${body}</p>
  </main>
</body>
</html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  if (!slug) {
    return htmlResponse("Link indisponivel", "Confira o link e tente novamente.", 404);
  }

  const admin = createAdminClient();
  const selection = await selectGroupForPoolRedirect(admin, slug);

  if (!selection) {
    return htmlResponse("Link indisponivel", "Esse grupo nao esta ativo no momento.", 404);
  }

  if (!selection.group?.inviteUrl) {
    return htmlResponse(
      "Grupo indisponivel",
      "Os grupos estao em manutencao. Tente novamente em alguns minutos.",
      503
    );
  }

  await recordPoolRedirect(admin, selection);

  return NextResponse.redirect(selection.group.inviteUrl, 302);
}
