import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { getVndaConfigForWorkspace } from "@/lib/coupons/vnda-coupons";

// GET /api/coupons/active/[id]/verify — re-fetches the promotion from VNDA
// to confirm it really exists with the configured discount and is enabled.
// Read-only: does not mutate the DB row.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const { id } = await params;
    const admin = createAdminClient();
    const { data: row } = await admin
      .from("promo_active_coupons")
      .select("vnda_discount_id, vnda_coupon_code, discount_pct")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();
    if (!row) return NextResponse.json({ error: "Cupom nao encontrado" }, { status: 404 });
    if (!row.vnda_discount_id) {
      return NextResponse.json({ ok: false, error: "Cupom ainda nao foi enviado pra VNDA" });
    }

    const config = await getVndaConfigForWorkspace(workspaceId);
    if (!config) return NextResponse.json({ ok: false, error: "VNDA nao configurada" });

    // Fetch the promotion + the coupon code endpoint to confirm both exist
    try {
      const [promoRes, codeRes] = await Promise.all([
        fetch(`https://api.vnda.com.br/api/v2/discounts/${row.vnda_discount_id}`, {
          headers: { Authorization: `Bearer ${config.apiToken}`, "X-Shop-Host": config.storeHost },
        }),
        fetch(`https://api.vnda.com.br/api/v2/coupon_codes/${encodeURIComponent(row.vnda_coupon_code)}`, {
          headers: { Authorization: `Bearer ${config.apiToken}`, "X-Shop-Host": config.storeHost },
        }),
      ]);
      const promoOk = promoRes.ok;
      const codeOk = codeRes.ok;
      const promo = promoOk ? await promoRes.json() : null;
      const code = codeOk ? await codeRes.json() : null;

      return NextResponse.json({
        ok: promoOk && codeOk,
        promotion_exists: promoOk,
        promotion_enabled: promo?.enabled ?? null,
        promotion_name: promo?.name ?? null,
        promotion_starts_at: promo?.start_at ?? null,
        promotion_ends_at: promo?.end_at ?? null,
        coupon_code_exists: codeOk,
        coupon_code: code?.code ?? row.vnda_coupon_code,
        coupon_uses_per_code: code?.uses_per_code ?? null,
        coupon_used_count: code?.used_count ?? null,
        vnda_discount_id: row.vnda_discount_id,
      });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  } catch (error) {
    return handleAuthError(error);
  }
}
