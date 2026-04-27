// Cria um plano de cupom smart de exemplo no workspace Bulking.
// Read-only-ish: insere uma linha em promo_coupon_plans, nada na VNDA.
// Run: npx tsx scripts/create-example-smart-plan.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase-admin";

async function main() {
  const admin = createAdminClient();
  const { data: ws } = await admin
    .from("workspaces").select("id, name").ilike("name", "%bulking%").limit(1).single();
  if (!ws) throw new Error("workspace bulking nao encontrado");

  const plan = {
    workspace_id: ws.id,
    name: "Smart Rotation — Cauda Longa",
    enabled: true,
    mode: "smart" as const,
    target: "low_cvr_high_views" as const,
    manual_product_ids: null,
    // Range: o picker escolhe entre 10% e 20% baseado no score
    discount_min_pct: 10,
    discount_max_pct: 20,
    duration_hours: 48,           // cada cupom vive 48h
    max_active_products: 5,        // até 5 produtos por execução
    recurring_cron: null,          // smart usa throttle interno de 24h
    require_manual_approval: false, // forçado pelo smart de qualquer jeito
    discount_unit: "auto" as const, // bandit decide entre % e R$
    cooldown_days: 7,              // mesmo produto só recebe outro cupom 7d depois de expirar
    badge_template: "{discount}% OFF | Cupom {coupon} | Acaba em {countdown}",
    badge_bg_color: "#0f172a",     // monocromático (paleta da loja)
    badge_text_color: "#ffffff",
  };

  // Evita criar duplicado se já existe um plano com mesmo nome
  const { data: existing } = await admin
    .from("promo_coupon_plans")
    .select("id")
    .eq("workspace_id", ws.id)
    .eq("name", plan.name)
    .maybeSingle();
  if (existing) {
    console.log(`Plano "${plan.name}" ja existe (id ${existing.id}). Atualizando enabled=true e config...`);
    const { error } = await admin
      .from("promo_coupon_plans")
      .update({ ...plan, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    console.log("OK — plano atualizado.");
    return;
  }

  const { data: created, error } = await admin
    .from("promo_coupon_plans")
    .insert(plan)
    .select()
    .single();
  if (error) throw new Error(error.message);

  console.log(`Plano criado: ${created.id}`);
  console.log(`  nome: ${created.name}`);
  console.log(`  modo: ${created.mode}`);
  console.log(`  alvo: ${created.target}`);
  console.log(`  desconto: ${created.discount_min_pct}-${created.discount_max_pct}% (unidade=${created.discount_unit})`);
  console.log(`  cooldown: ${created.cooldown_days} dias`);
  console.log(`  max ativos: ${created.max_active_products}`);
  console.log(`  duracao: ${created.duration_hours}h`);
  console.log(`  aprovacao manual: ${created.require_manual_approval}`);
  console.log(`\nProximos passos:`);
  console.log(`  1. Abra /coupons no painel`);
  console.log(`  2. Clique em "Rodar agora" no card do plano para disparar o picker imediato`);
  console.log(`  3. Confira aba Ativos (ou Aguardando aprovacao se mudou pra recurring)`);
  console.log(`  4. Apos 6h o cron de atribuicao roda automaticamente`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
