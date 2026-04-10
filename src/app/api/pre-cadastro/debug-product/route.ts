import { NextRequest, NextResponse } from "next/server";
import { eccosys } from "@/lib/eccosys/client";
export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) return NextResponse.json({ error: "ws" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id") || "";
  try { return NextResponse.json(await eccosys.get(`/produtos/${id}`)); }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) return NextResponse.json({ error: "ws" }, { status: 401 });
  const { action, payload } = await req.json();
  try {
    const result = action === "put"
      ? await eccosys.put("/produtos", payload)
      : await eccosys.post("/produtos", payload);
    return NextResponse.json({ ok: true, result });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
