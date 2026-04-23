import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";

export const maxDuration = 15;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { auth, error } = await authRoute(request);
  if (error) return error;

  const { id } = await params;
  const { data: tx } = await auth!.admin
    .from("cashback_transactions")
    .select("*")
    .eq("workspace_id", auth!.workspaceId)
    .eq("id", id)
    .maybeSingle();

  if (!tx) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: events } = await auth!.admin
    .from("cashback_events")
    .select("id, tipo, payload, created_at")
    .eq("cashback_id", id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ transaction: tx, events: events ?? [] });
}
