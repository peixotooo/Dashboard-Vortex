import { NextRequest, NextResponse } from "next/server";
import { eccosys } from "@/lib/eccosys/client";

export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  try {
    const departments = await eccosys.listAll("/departamentos");
    return NextResponse.json(departments);
  } catch (err) {
    return NextResponse.json(
      { error: `Erro ao buscar categorias: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }
}
