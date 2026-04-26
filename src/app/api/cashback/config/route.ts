import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";
import { getOrCreateConfig } from "@/lib/cashback/api";

export const maxDuration = 15;

const EDITABLE_FIELDS = [
  "percentage",
  "calculate_over",
  "deposit_delay_days",
  "validity_days",
  "reminder_1_day",
  "reminder_2_day",
  "reminder_3_day",
  "reactivation_days",
  "reactivation_reminder_day",
  "whatsapp_min_value",
  "email_min_value",
  "channel_mode",
  "enable_whatsapp",
  "enable_email",
  "enable_deposit",
  "enable_refund",
  "enable_troquecommerce",
  "excluded_client_tags",
] as const;

export async function GET(request: NextRequest) {
  const { auth, error } = await authRoute(request);
  if (error) return error;
  const cfg = await getOrCreateConfig(auth!.workspaceId, auth!.admin);
  return NextResponse.json({ config: cfg });
}

export async function PUT(request: NextRequest) {
  const { auth, error } = await authRoute(request, { requireAdmin: true });
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const field of EDITABLE_FIELDS) {
    if (field in body) patch[field] = body[field];
  }

  await getOrCreateConfig(auth!.workspaceId, auth!.admin);
  const { data, error: upErr } = await auth!.admin
    .from("cashback_config")
    .update(patch)
    .eq("workspace_id", auth!.workspaceId)
    .select("*")
    .single();

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ config: data });
}
