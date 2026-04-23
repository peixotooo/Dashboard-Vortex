import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";
import { saveTroqueConfig } from "@/lib/cashback/troquecommerce";

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const { auth, error } = await authRoute(request);
  if (error) return error;

  const { data } = await auth!.admin
    .from("troquecommerce_config")
    .select("base_url, updated_at")
    .eq("workspace_id", auth!.workspaceId)
    .maybeSingle();

  return NextResponse.json({ troque: data ?? null });
}

export async function PUT(request: NextRequest) {
  const { auth, error } = await authRoute(request, { requireAdmin: true });
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as {
    apiToken?: string;
    baseUrl?: string;
  };

  if (!body.apiToken) {
    return NextResponse.json({ error: "apiToken required" }, { status: 400 });
  }

  const result = await saveTroqueConfig(auth!.workspaceId, body.apiToken, body.baseUrl);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
