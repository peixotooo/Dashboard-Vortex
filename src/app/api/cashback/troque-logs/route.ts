import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const { auth, error } = await authRoute(request);
  if (error) return error;

  const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 50)));
  const status = request.nextUrl.searchParams.get("status");

  let query = auth!.admin
    .from("troquecommerce_webhook_logs")
    .select("id, external_id, ecommerce_number, reverse_type, status, cashback_id, amount_deducted, payload, error_message, created_at")
    .eq("workspace_id", auth!.workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error: dbErr } = await query;
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({ logs: data ?? [] });
}
