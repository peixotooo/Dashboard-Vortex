import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { eccosys } from "@/lib/eccosys/client";

export async function POST(req: NextRequest) {
  // Authenticate user
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = eccosys.getConfig();
  if (!config) {
    return NextResponse.json(
      { ok: false, message: "ECCOSYS_API_TOKEN nao configurado nas env vars da Vercel." },
      { status: 400 }
    );
  }

  try {
    const ok = await eccosys.testConnection(config.apiToken, config.ambiente);
    if (ok) {
      return NextResponse.json({
        ok: true,
        message: `Conexao OK — ambiente: ${config.ambiente}`,
      });
    }
    return NextResponse.json(
      { ok: false, message: "Falha na autenticacao. Verifique ECCOSYS_API_TOKEN na Vercel." },
      { status: 401 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
