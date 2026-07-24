import { NextRequest, NextResponse } from "next/server";
import { eccosys } from "@/lib/eccosys/client";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  try {
    await getWorkspaceContext(req);
  } catch (error) {
    return handleAuthError(error);
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
    console.error("[eccosys/test]", message);
    return NextResponse.json(
      { ok: false, message: "Não foi possível testar a conexão." },
      { status: 500 }
    );
  }
}
