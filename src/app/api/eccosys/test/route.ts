import { NextRequest, NextResponse } from "next/server";
import { eccosys } from "@/lib/eccosys/client";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { api_token, ambiente } = body;

  if (!api_token || !ambiente) {
    return NextResponse.json(
      { error: "api_token e ambiente sao obrigatorios" },
      { status: 400 }
    );
  }

  try {
    const ok = await eccosys.testConnection(api_token, ambiente.trim());
    if (ok) {
      return NextResponse.json({ ok: true, message: "Conexao com Eccosys OK" });
    }
    return NextResponse.json(
      { ok: false, message: "Falha na autenticacao. Verifique o token." },
      { status: 401 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
