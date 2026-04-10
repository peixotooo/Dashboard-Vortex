import { NextRequest, NextResponse } from "next/server";
import { eccosys } from "@/lib/eccosys/client";

export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id") || "";
  const action = req.nextUrl.searchParams.get("action") || "product";
  try {
    if (action === "attr") {
      const attr = await eccosys.get<unknown>(`/atributos/${id}`);
      return NextResponse.json(attr);
    }
    if (action === "attrs") {
      const attrs = await eccosys.get<unknown>("/atributos", undefined, { $offset: "0", $count: "200" });
      return NextResponse.json(attrs);
    }
    const product = await eccosys.get<unknown>(`/produtos/${id}`);
    return NextResponse.json(product);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
}
