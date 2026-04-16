import { NextRequest, NextResponse } from "next/server";
import { eccosys } from "@/lib/eccosys/client";

/**
 * GET — Debug: list all Eccosys transportadoras and contatos to find Mercado Envios
 */
export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  for (const path of [
    "/transportadoras",
    "/contatos?$tipoContato=T",
    "/contatos?$tipo=T",
    "/contatos?$nome=Mercado",
  ]) {
    try {
      const result = await eccosys.get<unknown>(path, workspaceId);
      const list = Array.isArray(result) ? result : [];
      results[path] = {
        count: list.length,
        sample: list.slice(0, 3),
        mercadoMatches: list.filter((item: unknown) => {
          const obj = item as Record<string, unknown>;
          const nome = String(obj.nome || obj.razaoSocial || obj.fantasia || "");
          return /mercado/i.test(nome);
        }),
      };
    } catch (err) {
      results[path] = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return NextResponse.json(results);
}
