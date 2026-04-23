/**
 * Reverts cashback row d94bea1b-... (pedido 5E79A66A7C) back to
 * AGUARDANDO_DEPOSITO so that when enable_deposit is flipped on in
 * production the cron will properly deposit the credit at D+15.
 *
 * Original deposit_delay_days=15 + validity_days=30 → expira_em = confirmado + 45d.
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TARGET_ID = "d94bea1b-c3e5-4683-b06f-2f309493cfbd";

async function main() {
  const { data: row } = await db
    .from("cashback_transactions")
    .select("*")
    .eq("id", TARGET_ID)
    .single();
  if (!row) {
    console.error("row not found");
    process.exit(1);
  }
  console.log("Before:", { status: row.status, depositado_em: row.depositado_em, expira_em: row.expira_em });

  const confirmado = new Date(row.confirmado_em);
  const newExpira = new Date(confirmado);
  newExpira.setUTCDate(newExpira.getUTCDate() + 15 + 30);

  const { error } = await db
    .from("cashback_transactions")
    .update({
      status: "AGUARDANDO_DEPOSITO",
      depositado_em: null,
      expira_em: newExpira.toISOString(),
      lembrete1_enviado_em: null,
      lembrete2_enviado_em: null,
      lembrete3_enviado_em: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", TARGET_ID);
  if (error) {
    console.error("update error:", error);
    process.exit(1);
  }

  // Delete the erroneous DEPOSITO event from the E2E window
  const sinceIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: delEvents } = await db
    .from("cashback_events")
    .delete()
    .eq("cashback_id", TARGET_ID)
    .gte("created_at", sinceIso)
    .select("id, tipo");
  console.log("Events removed:", delEvents?.length || 0, delEvents?.map((e) => e.tipo));

  // Log an audit event for the rollback so we keep the trail
  await db.from("cashback_events").insert({
    workspace_id: row.workspace_id,
    cashback_id: TARGET_ID,
    tipo: "E2E_ROLLBACK",
    payload: {
      reason: "E2E test leak — deposit happened in shadow mode with enable_deposit=false, no real VNDA credit was deposited",
      rolled_back_to: "AGUARDANDO_DEPOSITO",
      original_confirmado_em: row.confirmado_em,
    },
  });

  const { data: after } = await db
    .from("cashback_transactions")
    .select("status, depositado_em, expira_em")
    .eq("id", TARGET_ID)
    .single();
  console.log("After:", after);
  console.log("\n✅ rollback complete.");
}
main();
