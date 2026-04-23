import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";
import { saveSmtpConfig } from "@/lib/cashback/locaweb-smtp";

export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const { auth, error } = await authRoute(request);
  if (error) return error;

  const { data } = await auth!.admin
    .from("smtp_config")
    .select("provider, from_email, from_name, reply_to, updated_at")
    .eq("workspace_id", auth!.workspaceId)
    .maybeSingle();

  return NextResponse.json({ smtp: data ?? null });
}

export async function PUT(request: NextRequest) {
  const { auth, error } = await authRoute(request, { requireAdmin: true });
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as {
    provider?: "locaweb" | "resend" | "sendgrid" | "custom";
    apiToken?: string;
    fromEmail?: string;
    fromName?: string;
    replyTo?: string;
  };

  if (!body.apiToken || !body.fromEmail) {
    return NextResponse.json({ error: "apiToken and fromEmail are required" }, { status: 400 });
  }

  const result = await saveSmtpConfig(auth!.workspaceId, {
    provider: body.provider || "locaweb",
    apiToken: body.apiToken,
    fromEmail: body.fromEmail,
    fromName: body.fromName,
    replyTo: body.replyTo,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
