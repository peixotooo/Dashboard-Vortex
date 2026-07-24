import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";
import { saveTroqueConfig } from "@/lib/cashback/troquecommerce";
import { consumeSecurityRateLimit } from "@/lib/security/rate-limit";
import { readLimitedJson } from "@/lib/security/webhook-request";

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

  const parsed = await readLimitedJson(request, 32 * 1024);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error },
      { status: parsed.status }
    );
  }
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const body = parsed.value as {
    apiToken?: string;
    baseUrl?: string;
  };

  if (
    typeof body.apiToken !== "string" ||
    body.apiToken.trim().length < 8 ||
    body.apiToken.length > 8192
  ) {
    return NextResponse.json({ error: "apiToken inválido" }, { status: 400 });
  }
  if (
    body.baseUrl !== undefined &&
    (typeof body.baseUrl !== "string" || body.baseUrl.length > 2048)
  ) {
    return NextResponse.json({ error: "baseUrl inválida" }, { status: 400 });
  }

  const rate = await consumeSecurityRateLimit({
    scope: "cashback:troque-config",
    key: `${auth!.workspaceId}:${auth!.userId}`,
    limit: 20,
    windowSeconds: 3600,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const result = await saveTroqueConfig(
    auth!.workspaceId,
    body.apiToken.trim(),
    body.baseUrl
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
