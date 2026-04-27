// Preview which products the coupon-rotation algorithm would pick.
// READ-ONLY — does not write to DB or call VNDA.
// Run: npx tsx scripts/preview-coupon-picks.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase-admin";
import { computeProductPerformance } from "../src/lib/coupons/performance";
import { pickCouponCandidates } from "../src/lib/coupons/picker";

async function main() {
  const admin = createAdminClient();
  const { data: ws } = await admin
    .from("workspaces")
    .select("id, name")
    .ilike("name", "%bulking%")
    .limit(1)
    .single();
  if (!ws) throw new Error("workspace nao encontrado");
  console.log(`Workspace: ${ws.name} (${ws.id})\n`);

  console.log("Computando performance (GA4 itemViews 30d + VNDA orders 30d)...");
  const t0 = Date.now();
  const perf = await computeProductPerformance(ws.id);
  console.log(`OK — ${perf.length} produtos em ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  // Distribuição ABC
  const tierCount = { A: 0, B: 0, C: 0 };
  for (const p of perf) tierCount[p.abc_tier]++;
  console.log(`=== Distribuicao ABC (por receita 30d) ===`);
  console.log(`  A (top 50% receita): ${tierCount.A}`);
  console.log(`  B (50-80%):          ${tierCount.B}`);
  console.log(`  C (cauda longa):     ${tierCount.C}\n`);

  // Top 10 por score (low_rotation_score)
  const topScore = [...perf].sort((a, b) => b.low_rotation_score - a.low_rotation_score).slice(0, 10);
  console.log(`=== Top 10 por low_rotation_score ===`);
  console.log(`Score | Tier | Views | Vendas | Receita     | CVR    | Produto`);
  console.log(`------+------+-------+--------+-------------+--------+--------`);
  for (const p of topScore) {
    console.log(
      `${p.low_rotation_score.toFixed(2).padStart(5)} | ${p.abc_tier.padEnd(4)} | ${String(p.views).padStart(5)} | ${String(p.units_sold).padStart(6)} | ${p.revenue.toFixed(2).padStart(11)} | ${(p.cvr * 100).toFixed(2).padStart(5)}% | ${p.name.slice(0, 50)}`
    );
  }

  // Preview — simulando um plano de cupom
  const PLANS = [
    { label: "low_cvr_high_views (8 produtos, 10-20%)", target: "low_cvr_high_views" as const, min: 10, max: 20, max_active: 8 },
    { label: "tier_c (5 produtos, 15-25%)", target: "tier_c" as const, min: 15, max: 25, max_active: 5 },
    { label: "tier_b (5 produtos, 5-15%)", target: "tier_b" as const, min: 5, max: 15, max_active: 5 },
  ];

  for (const plan of PLANS) {
    console.log(`\n=== Plano: ${plan.label} ===`);
    const picks = pickCouponCandidates({
      performance: perf,
      target: plan.target,
      discountMinPct: plan.min,
      discountMaxPct: plan.max,
      maxActiveProducts: plan.max_active,
    });
    if (picks.length === 0) {
      console.log("  (sem candidatos)");
      continue;
    }
    console.log(`Desc% | Tier | Views | Vendas | Receita     | Score | Cupom seria criado para:`);
    console.log(`------+------+-------+--------+-------------+-------+--------------------------`);
    for (const p of picks) {
      console.log(
        `${String(p.discount_pct).padStart(4)}% | ${p.abc_tier.padEnd(4)} | ${String(p.views).padStart(5)} | ${String(p.units_sold).padStart(6)} | ${p.revenue.toFixed(2).padStart(11)} | ${p.low_rotation_score.toFixed(2)} | ${p.product_id} - ${p.name.slice(0, 40)}`
      );
    }
    // Estimativa de receita potencial (assumindo CVR média atual)
    const potentialRevenue = picks.reduce((sum, p) => {
      // Hipotese simples: cupom dobra a CVR do produto
      const newUnits = p.views * Math.min(p.cvr * 2, 0.05); // teto 5% CVR
      const discountedPrice = p.effective_price * (1 - p.discount_pct / 100);
      return sum + newUnits * discountedPrice;
    }, 0);
    console.log(`  Receita estimada (CVR ×2, teto 5%): R$ ${potentialRevenue.toFixed(2)}`);
  }

  console.log(`\n--- Nada foi criado na VNDA. Isso e apenas preview. ---`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
