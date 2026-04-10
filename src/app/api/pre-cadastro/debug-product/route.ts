import { NextRequest, NextResponse } from "next/server";
import { eccosys } from "@/lib/eccosys/client";

export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const product = await eccosys.get<unknown>(`/produtos/${id}`);
    return NextResponse.json(product);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
}

// POST: test setting an attribute on a product
export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  const body = await req.json();
  const { productId, action, payload } = body as { productId: string; action: string; payload: unknown };

  try {
    let result: unknown;
    if (action === "post_attr") {
      result = await eccosys.post(`/produtos/${productId}/atributos`, payload);
    } else if (action === "put_product") {
      result = await eccosys.put("/produtos", payload);
    } else if (action === "get_attrs") {
      result = await eccosys.get(`/produtos/${productId}/atributos`);
    }
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
}
