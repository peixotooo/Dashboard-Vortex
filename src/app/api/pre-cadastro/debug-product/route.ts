import { NextRequest, NextResponse } from "next/server";
import { eccosys } from "@/lib/eccosys/client";

export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id") || "";
  try {
    const product = await eccosys.get<unknown>(`/produtos/${id}`);
    return NextResponse.json(product);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  const { action, payload } = await req.json();
  try {
    let result: unknown;
    if (action === "post") result = await eccosys.post("/produtos", payload);
    else if (action === "put") result = await eccosys.put("/produtos", payload);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
}
