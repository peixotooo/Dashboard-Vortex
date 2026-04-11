import { NextRequest, NextResponse } from "next/server";
import { eccosys } from "@/lib/eccosys/client";
export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) return NextResponse.json({ error: "ws" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id") || "";
  const action = req.nextUrl.searchParams.get("action") || "get";
  try {
    if (action === "delete") {
      const result = await eccosys.delete(`/produtos/${id}`);
      return NextResponse.json({ ok: true, deleted: id, result });
    }
    return NextResponse.json(await eccosys.get(`/produtos/${id}`));
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
