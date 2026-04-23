import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const { auth, error } = await authRoute(request);
  if (error) return error;

  const [{ data: vnda }, { data: smtp }, { data: troque }] = await Promise.all([
    auth!.admin
      .from("vnda_connections")
      .select("id, store_host, enable_cashback, webhook_token, created_at")
      .eq("workspace_id", auth!.workspaceId)
      .order("created_at", { ascending: false }),
    auth!.admin
      .from("smtp_config")
      .select("provider, from_email, from_name, reply_to, updated_at")
      .eq("workspace_id", auth!.workspaceId)
      .maybeSingle(),
    auth!.admin
      .from("troquecommerce_config")
      .select("base_url, updated_at")
      .eq("workspace_id", auth!.workspaceId)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    vnda: vnda ?? [],
    smtp: smtp ?? null,
    troque: troque ?? null,
  });
}

export async function PATCH(request: NextRequest) {
  const { auth, error } = await authRoute(request, { requireAdmin: true });
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as {
    vndaConnectionId?: string;
    enableCashback?: boolean;
  };

  if (!body.vndaConnectionId || typeof body.enableCashback !== "boolean") {
    return NextResponse.json({ error: "vndaConnectionId + enableCashback required" }, { status: 400 });
  }

  const { error: upErr } = await auth!.admin
    .from("vnda_connections")
    .update({ enable_cashback: body.enableCashback })
    .eq("workspace_id", auth!.workspaceId)
    .eq("id", body.vndaConnectionId);

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
