/**
 * Activates WhatsApp dispatch for cashback reminders:
 *   1. Sets wa_template_name on the 3 stages we have approved Meta templates for
 *      (LEMBRETE_1 → cashback_01, _2 → cashback_02, _3 → cashback_03)
 *   2. Bumps WhatsApp min value gate from R$10 to R$20
 *   3. Switches channel_mode to "both" (was "email_only")
 *   4. Sets enable_whatsapp = true
 *
 * Reactivation stages stay null (no Meta-approved templates yet) — the runtime
 * skips them gracefully with skipped=no_template.
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data: conn } = await db.from("vnda_connections").select("workspace_id").eq("enable_cashback", true).limit(1).single();
  const workspaceId = conn!.workspace_id as string;

  const mapping: Array<{ estagio: string; wa_template_name: string }> = [
    { estagio: "LEMBRETE_1", wa_template_name: "cashback_01" },
    { estagio: "LEMBRETE_2", wa_template_name: "cashback_02" },
    { estagio: "LEMBRETE_3", wa_template_name: "cashback_03" },
  ];

  console.log("\n→ Atualizando wa_template_name por estágio:");
  for (const m of mapping) {
    const { error } = await db
      .from("cashback_reminder_templates")
      .update({
        wa_template_name: m.wa_template_name,
        wa_template_language: "pt_BR",
        enabled: true,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .eq("canal", "whatsapp")
      .eq("estagio", m.estagio);
    if (error) {
      console.log(`  ❌ ${m.estagio}: ${error.message}`);
      process.exit(1);
    }
    console.log(`  ✅ ${m.estagio} → ${m.wa_template_name}`);
  }
  console.log("  ℹ️  REATIVACAO e REATIVACAO_LEMBRETE permanecem com wa_template_name=null (sem template aprovado na Meta — não disparam)");

  console.log("\n→ Atualizando cashback_config:");
  const { error: cfgErr, data: cfg } = await db
    .from("cashback_config")
    .update({
      whatsapp_min_value: 20,
      enable_whatsapp: true,
      channel_mode: "both",
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .select("whatsapp_min_value, enable_whatsapp, channel_mode")
    .single();
  if (cfgErr) {
    console.log(`  ❌ ${cfgErr.message}`);
    process.exit(1);
  }
  console.log(`  ✅ whatsapp_min_value=${cfg.whatsapp_min_value}`);
  console.log(`  ✅ enable_whatsapp=${cfg.enable_whatsapp}`);
  console.log(`  ✅ channel_mode=${cfg.channel_mode}`);

  // Final: list pending cashbacks that will receive WhatsApp on D+15
  const { data: pending } = await db
    .from("cashback_transactions")
    .select("numero_pedido, email, telefone, valor_cashback")
    .eq("workspace_id", workspaceId)
    .eq("status", "AGUARDANDO_DEPOSITO")
    .gte("valor_cashback", 20);

  console.log(`\n→ Cashbacks pendentes que receberão WhatsApp (gate R$20+): ${pending?.length || 0}`);
  let semTelefone = 0;
  for (const p of pending || []) {
    if (!p.telefone) {
      semTelefone++;
    }
  }
  console.log(`   ${(pending?.length || 0) - semTelefone} com telefone · ${semTelefone} sem telefone (não recebem WhatsApp)`);

  console.log("\n✅ WhatsApp ativado.");
}
main();
