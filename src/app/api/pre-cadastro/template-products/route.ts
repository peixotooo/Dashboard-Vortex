import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { eccosys } from "@/lib/eccosys/client";

export async function GET(req: NextRequest) {
  try {
    await getWorkspaceContext(req);
  } catch (error) {
    return handleAuthError(error);
  }

  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search") || "";
  const page = parseInt(searchParams.get("page") || "0", 10);
  const pageSize = 20;

  try {
    const params: Record<string, string> = {
      $offset: String(page * pageSize),
      $count: String(pageSize),
      $situacao: "A",
    };

    const products = await eccosys.get<Record<string, unknown>[]>("/produtos", undefined, params);

    // Filter by search term (name or code) if provided
    let filtered = products || [];
    if (search) {
      const term = search.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          String(p.nome || "").toLowerCase().includes(term) ||
          String(p.codigo || "").toLowerCase().includes(term)
      );
    }

    // Return simplified list
    const results = filtered.map((p) => ({
      id: p.id,
      nome: p.nome,
      codigo: p.codigo,
      preco: p.preco,
      cf: p.cf,
      unidade: p.unidade,
    }));

    return NextResponse.json(results);
  } catch (err) {
    return NextResponse.json(
      { error: `Erro ao buscar produtos: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }
}
