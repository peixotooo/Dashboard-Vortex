// Aplica cap global de 15% no workspace Bulking + ajusta o plano-exemplo.
// Run: npx tsx scripts/set-discount-cap.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase-admin";
import { upsertCouponSettings } from "../src/lib/coupons/settings";

const NEW_CAP = 15;

async function main() {
  const admin = createAdminClient();
  const { data: ws } = await admin
    .from("workspaces").select("id, name").ilike("name", "%bulking%").limit(1).single();
  if (!ws) throw new Error("workspace bulking nao encontrado");

  // 1. Trava global do workspace — nenhum plano pode passar disto
  const settings = await upsertCouponSettings(ws.id, { global_max_discount_pct: NEW_CAP });
  console.log(`Cap global do workspace: ${settings.global_max_discount_pct}%`);

  // 2. Ajustar planos existentes que excedem o novo cap
  const { data: plans } = await admin
    .from("promo_coupon_plans")
    .select("id, name, discount_min_pct, discount_max_pct")
    .eq("workspace_id", ws.id);
  if (!plans || plans.length === 0) {
    console.log("Sem planos pra ajustar.");
    return;
  }

  for (const p of plans) {
    const newMax = Math.min(NEW_CAP, Number(p.discount_max_pct));
    const newMin = Math.min(newMax, Number(p.discount_min_pct));
    if (newMax === Number(p.discount_max_pct) && newMin === Number(p.discount_min_pct)) {
      console.log(`  ${p.name}: ja dentro do cap (${p.discount_min_pct}-${p.discount_max_pct}%)`);
      continue;
    }
    await admin
      .from("promo_coupon_plans")
      .update({
        discount_min_pct: newMin,
        discount_max_pct: newMax,
        updated_at: new Date().toISOString(),
      })
      .eq("id", p.id);
    console.log(`  ${p.name}: ${p.discount_min_pct}-${p.discount_max_pct}% → ${newMin}-${newMax}%`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
