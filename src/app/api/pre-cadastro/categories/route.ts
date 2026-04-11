import { NextRequest, NextResponse } from "next/server";
import { eccosys } from "@/lib/eccosys/client";

export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  try {
    const response = await eccosys.get<unknown>("/departamentos");
    let departments: unknown[] = [];
    if (Array.isArray(response)) {
      departments = response;
    } else if (response && typeof response === "object" && "departamentos" in (response as Record<string, unknown>)) {
      departments = (response as { departamentos: unknown[] }).departamentos;
    }
    return NextResponse.json(departments);
  } catch (err) {
    return NextResponse.json(
      { error: `Erro ao buscar categorias: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }
}
