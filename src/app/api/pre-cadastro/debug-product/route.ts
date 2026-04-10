import { NextRequest, NextResponse } from "next/server";
import { eccosys } from "@/lib/eccosys/client";

export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id") || "";
  const action = req.nextUrl.searchParams.get("action") || "product";
  try {
    if (action === "categorias") {
      return NextResponse.json(await eccosys.get("/departamentos", undefined, { $offset: "0", $count: "50" }));
    }
    return NextResponse.json(await eccosys.get(`/produtos/${id}`));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  const { action, codigo, payload } = await req.json();
  try {
    let result: unknown;
    if (action === "categorizacao") {
      result = await eccosys.post(`/produtos/${codigo}/categorizacao`, payload);
    }
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
}
