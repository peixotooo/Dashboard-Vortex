// Aumenta o volume do plano-exemplo (max_active_products) + cap global do workspace.
// Run: npx tsx scripts/bump-smart-plan-volume.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase-admin";
import { upsertCouponSettings } from "../src/lib/coupons/settings";

const NEW_PLAN_MAX = 15;
const NEW_WORKSPACE_BUDGET = 50;

async function main() {
  const admin = createAdminClient();
  const { data: ws } = await admin
    .from("workspaces").select("id, name").ilike("name", "%bulking%").limit(1).single();
  if (!ws) throw new Error("workspace bulking nao encontrado");

  const settings = await upsertCouponSettings(ws.id, {
    global_max_active_coupons: NEW_WORKSPACE_BUDGET,
  });
  console.log(`Cap global de cupons ativos simultâneos no workspace: ${settings.global_max_active_coupons}`);

  const { data: updated, error } = await admin
    .from("promo_coupon_plans")
    .update({ max_active_products: NEW_PLAN_MAX, updated_at: new Date().toISOString() })
    .eq("workspace_id", ws.id)
    .eq("name", "Smart Rotation — Cauda Longa")
    .select("id, name, max_active_products")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (updated) {
    console.log(`Plano "${updated.name}": max_active_products = ${updated.max_active_products}`);
  } else {
    console.log("Plano de exemplo nao encontrado.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
