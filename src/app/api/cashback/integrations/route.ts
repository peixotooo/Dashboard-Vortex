import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";
import { getDashboardOrigin } from "@/lib/security/dashboard-origin";
import { readLimitedJson } from "@/lib/security/webhook-request";

export const maxDuration = 15;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      .select("base_url, webhook_token, updated_at")
      .eq("workspace_id", auth!.workspaceId)
      .maybeSingle(),
  ]);

  // webhook_token (VNDA e Troque) é um segredo que autentica webhooks de
  // pedido/reembolso do motor de cashback. Só owner/admin podem vê-lo.
  const isAdmin = auth!.role === "owner" || auth!.role === "admin";
  const vndaSafe = (vnda ?? []).map((c) =>
    isAdmin ? c : { ...c, webhook_token: null }
  );

  const origin = getDashboardOrigin(request.nextUrl.origin);
  const troqueWebhookUrl =
    isAdmin && troque?.webhook_token
      ? `${origin}/api/webhooks/troquecommerce?token=${troque.webhook_token}`
      : null;

  // Recent webhook activity (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
  const { data: recentWebhooks } = await auth!.admin
    .from("troquecommerce_webhook_logs")
    .select("status, created_at")
    .eq("workspace_id", auth!.workspaceId)
    .gte("created_at", sevenDaysAgo.toISOString());

  return NextResponse.json({
    vnda: vndaSafe,
    smtp: smtp ?? null,
    troque: troque
      ? { base_url: troque.base_url, updated_at: troque.updated_at, webhook_url: troqueWebhookUrl }
      : null,
    troque_webhook_activity_7d: {
      total: recentWebhooks?.length ?? 0,
      processed: (recentWebhooks ?? []).filter((r) => r.status === "processed").length,
      no_cashback: (recentWebhooks ?? []).filter((r) => r.status === "no_cashback").length,
      duplicate: (recentWebhooks ?? []).filter((r) => r.status === "duplicate").length,
      error: (recentWebhooks ?? []).filter((r) => r.status === "error").length,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const { auth, error } = await authRoute(request, { requireAdmin: true });
  if (error) return error;

  const parsed = await readLimitedJson(request, 32 * 1024);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const body = (parsed.value || {}) as {
    vndaConnectionId?: string;
    enableCashback?: boolean;
  };

  if (
    !body.vndaConnectionId ||
    !UUID_RE.test(body.vndaConnectionId) ||
    typeof body.enableCashback !== "boolean"
  ) {
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
