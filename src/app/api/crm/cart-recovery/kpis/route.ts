import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

// GET /api/crm/cart-recovery/kpis
//
// Agrega métricas da régua de recuperação pra os cards do topo da página:
//   - totals: count+value por status (open/recovered/expired/closed)
//   - by_step: pra cada step da régua, quantos carts recuperaram após
//     ele ser o ÚLTIMO disparado antes do recovered_at (atribuição
//     last-touch). Mostra step_order=0 pra carts que recuperaram sem
//     receber nenhuma mensagem (compra orgânica/checkout direto).
//   - coupon_breakdown: separa recuperados em 3 buckets
//     (com cupom usado / com cupom não usado / sem cupom enviado).
//     Pra saber se usou, cruzamos coupon_code de abandoned_carts com
//     cupom do crm_vendas pelo email do cliente.
//
// Cálculos feitos em JS porque Supabase JS não suporta CTEs/window
// functions diretamente. Workspaces grandes (~10k carts) ainda rodam OK
// porque só puxamos colunas leves.

interface CartLite {
  id: string;
  status: string;
  cart_total: number | null;
  coupon_code: string | null;
  customer_email: string;
  abandoned_at: string;
  recovered_at: string | null;
}

interface MessageLite {
  cart_id: string;
  step_id: string;
  sent_at: string;
}

interface StatusAgg {
  count: number;
  value: number;
}

function emptyAgg(): StatusAgg {
  return { count: 0, value: 0 };
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const admin = createAdminClient();

    // 1. Carts (só colunas relevantes pros KPIs).
    const { data: carts } = await admin
      .from("abandoned_carts")
      .select(
        "id, status, cart_total, coupon_code, customer_email, abandoned_at, recovered_at"
      )
      .eq("workspace_id", workspaceId);

    const cartList = (carts || []) as CartLite[];
    const recoveredCarts = cartList.filter((c) => c.status === "recovered");
    const recoveredIds = recoveredCarts.map((c) => c.id);

    // 2. Steps da régua atual (id → step_order).
    const { data: rule } = await admin
      .from("cart_recovery_rules")
      .select("id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const stepOrderById = new Map<string, number>();
    if (rule) {
      const { data: steps } = await admin
        .from("cart_recovery_steps")
        .select("id, step_order")
        .eq("rule_id", rule.id);
      for (const s of steps || []) {
        stepOrderById.set(s.id, s.step_order);
      }
    }

    // 3. Mensagens enviadas pros carts recuperados, pra resolver o
    //    "último step antes do recovered_at" (last-touch attribution).
    const lastStepByCart = new Map<string, number>();
    if (recoveredIds.length > 0) {
      const { data: messages } = await admin
        .from("cart_recovery_messages")
        .select("cart_id, step_id, sent_at")
        .in("cart_id", recoveredIds)
        .eq("status", "sent")
        .order("sent_at", { ascending: true });

      const recoveredAtByCart = new Map(
        recoveredCarts.map((c) => [c.id, c.recovered_at])
      );

      for (const msg of (messages || []) as MessageLite[]) {
        const recoveredAt = recoveredAtByCart.get(msg.cart_id);
        if (!recoveredAt) continue;
        if (new Date(msg.sent_at) > new Date(recoveredAt)) continue;
        const stepOrder = stepOrderById.get(msg.step_id);
        if (stepOrder !== undefined) {
          // Como ordenamos por sent_at asc, o último set vence = último step.
          lastStepByCart.set(msg.cart_id, stepOrder);
        }
      }
    }

    // 4. Pra saber se usou cupom: cruzar email com crm_vendas e verificar
    //    se o cupom usado bate com o coupon_code que mandamos.
    const cupomUsadoByEmail = new Map<string, string | null>();
    if (recoveredIds.length > 0) {
      const recoveredEmails = recoveredCarts
        .map((c) => c.customer_email)
        .filter(Boolean);
      if (recoveredEmails.length > 0) {
        const { data: vendas } = await admin
          .from("crm_vendas")
          .select("email, cupom, data_compra")
          .eq("workspace_id", workspaceId)
          .in("email", recoveredEmails)
          .order("data_compra", { ascending: false });

        // Mantém só o cupom da venda mais recente por email (já ordenado desc).
        for (const v of (vendas || []) as Array<{
          email: string;
          cupom: string | null;
        }>) {
          if (!cupomUsadoByEmail.has(v.email)) {
            cupomUsadoByEmail.set(v.email, v.cupom);
          }
        }
      }
    }

    // ============ Agregações ============

    // Totais por status.
    const totals: Record<string, StatusAgg> = {
      open: emptyAgg(),
      recovered: emptyAgg(),
      expired: emptyAgg(),
      closed: emptyAgg(),
    };
    for (const c of cartList) {
      const bucket = totals[c.status];
      if (!bucket) continue;
      bucket.count++;
      bucket.value += Number(c.cart_total) || 0;
    }

    // Conversão por etapa (last-touch attribution).
    // step_order=0 → recuperou sem receber nenhuma mensagem.
    const byStepMap = new Map<number, StatusAgg>();
    for (const c of recoveredCarts) {
      const stepOrder = lastStepByCart.get(c.id) ?? 0;
      if (!byStepMap.has(stepOrder)) byStepMap.set(stepOrder, emptyAgg());
      const agg = byStepMap.get(stepOrder)!;
      agg.count++;
      agg.value += Number(c.cart_total) || 0;
    }
    const byStep = Array.from(byStepMap.entries())
      .map(([step_order, agg]) => ({ step_order, ...agg }))
      .sort((a, b) => a.step_order - b.step_order);

    // Cupom: 3 buckets.
    //   coupon_sent_used: cart tinha coupon_code E ele aparece em crm_vendas.cupom
    //   coupon_sent_unused: cart tinha coupon_code mas crm_vendas.cupom é diferente/null
    //   no_coupon_sent: cart sem coupon_code (não chegou no step que gera cupom)
    const couponBreakdown = {
      coupon_sent_used: emptyAgg(),
      coupon_sent_unused: emptyAgg(),
      no_coupon_sent: emptyAgg(),
    };
    for (const c of recoveredCarts) {
      const value = Number(c.cart_total) || 0;
      if (c.coupon_code) {
        const cupomUsado = cupomUsadoByEmail.get(c.customer_email);
        const usou =
          cupomUsado &&
          cupomUsado.toUpperCase() === c.coupon_code.toUpperCase();
        const bucket = usou
          ? couponBreakdown.coupon_sent_used
          : couponBreakdown.coupon_sent_unused;
        bucket.count++;
        bucket.value += value;
      } else {
        couponBreakdown.no_coupon_sent.count++;
        couponBreakdown.no_coupon_sent.value += value;
      }
    }

    // Conversão geral = recovered / (recovered + expired + open + closed)
    const totalCarts = cartList.length;
    const conversionPct =
      totalCarts > 0
        ? (totals.recovered.count / totalCarts) * 100
        : 0;

    return NextResponse.json({
      totals,
      by_step: byStep,
      coupon_breakdown: couponBreakdown,
      total_carts: totalCarts,
      conversion_pct: conversionPct,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
