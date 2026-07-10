import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

// GET /api/crm/cart-recovery/carts?status=open&limit=50
// Lista carrinhos do workspace (filtrável por status) com contagem de
// mensagens enviadas. Usado pra dashboard de monitoramento na UI.
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const status = request.nextUrl.searchParams.get("status");
    const limit = Math.min(
      200,
      Number(request.nextUrl.searchParams.get("limit") || 50)
    );

    const admin = createAdminClient();

    let query = admin
      .from("abandoned_carts")
      .select(
        "id, vnda_cart_token, customer_email, customer_name, customer_state, customer_region, cart_total, status, abandoned_at, recovered_at, recovery_url, items, coupon_code, recovery_coupon_expires_at, recovery_started_at"
      )
      .eq("workspace_id", workspaceId)
      .order("abandoned_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);

    const { data: carts, error } = await query;
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    // Counts agregados rápidos pra header do dashboard.
    const { data: counts } = await admin
      .from("abandoned_carts")
      .select("status")
      .eq("workspace_id", workspaceId);

    const summary = (counts || []).reduce(
      (acc: Record<string, number>, r) => {
        acc[r.status as string] = (acc[r.status as string] || 0) + 1;
        return acc;
      },
      {}
    );

    // Total de steps na régua atual + messages enviadas por cart, pra
    // calcular barra de progresso. Steps únicos (distinct step_id) que
    // tiveram pelo menos 1 mensagem sent/failed por cart.
    const { data: rule } = await admin
      .from("cart_recovery_rules")
      .select("id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    let totalSteps = 0;
    const progressByCart = new Map<string, number>();

    if (rule) {
      const activeStepCountResult = await admin
        .from("cart_recovery_steps")
        .select("id", { count: "exact", head: true })
        .eq("rule_id", rule.id)
        .eq("active", true);
      const legacyStepCountResult = activeStepCountResult.error
        ? await admin
            .from("cart_recovery_steps")
            .select("id", { count: "exact", head: true })
            .eq("rule_id", rule.id)
        : null;
      totalSteps = activeStepCountResult.error
        ? legacyStepCountResult?.count || 0
        : activeStepCountResult.count || 0;

      // Pega messages de todos os carts da página, agrupa por cart_id.
      // Conta steps únicos (não channels) pra progresso real.
      const cartIds = (carts || []).map((c) => c.id);
      if (cartIds.length > 0) {
        const { data: messages } = await admin
          .from("cart_recovery_messages")
          .select("cart_id, step_id")
          .in("cart_id", cartIds);
        const stepsByCart = new Map<string, Set<string>>();
        for (const m of messages || []) {
          if (!stepsByCart.has(m.cart_id))
            stepsByCart.set(m.cart_id, new Set());
          stepsByCart.get(m.cart_id)!.add(m.step_id);
        }
        for (const [cartId, steps] of stepsByCart) {
          progressByCart.set(cartId, steps.size);
        }
      }
    }

    const cartsWithProgress = (carts || []).map((c) => ({
      ...c,
      steps_sent: progressByCart.get(c.id) || 0,
      steps_total: totalSteps,
    }));

    return NextResponse.json({
      carts: cartsWithProgress,
      summary,
      total_steps: totalSteps,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
