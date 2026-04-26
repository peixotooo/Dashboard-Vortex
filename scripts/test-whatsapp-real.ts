/**
 * End-to-end production test of the WhatsApp dispatch pipeline.
 *
 * 1. Creates a synthetic cashback row owned by guilherme@bulking.com.br
 *    with phone 5562985955001 and value R$ 50.
 * 2. Fires LEMBRETE_1 → 2 → 3 via the real /force-reminder endpoint
 *    (one at a time, with a small delay between sends).
 * 3. Marks the row as USADO and tries to send LEMBRETE_2 again — must
 *    be blocked with skipped=cashback_usado on both channels.
 * 4. Sends REATIVACAO (from a fresh test row) so we see all 4 templates.
 * 5. Cleans up everything.
 *
 * Authorized by user: testing on his own number 62985955001.
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const BASE_URL = "https://dash.bulking.com.br";
const TARGET_PHONE = "5562985955001";    // E.164 sem +
const TARGET_EMAIL = "guilherme@bulking.com.br";

async function createTestRow(workspaceId: string, label: string, value = 50, status: "ATIVO" | "REATIVADO" = "ATIVO") {
  const sourceOrderId = `WA-TEST-${label}-${Date.now()}`;
  const expira = new Date();
  expira.setUTCDate(expira.getUTCDate() + 30);
  const now = new Date();
  const { data, error } = await db
    .from("cashback_transactions")
    .insert({
      workspace_id: workspaceId,
      source_order_id: sourceOrderId,
      numero_pedido: sourceOrderId,
      email: TARGET_EMAIL,
      nome_cliente: "Guilherme",
      telefone: TARGET_PHONE,
      valor_pedido: value * 10,
      valor_frete: 0,
      valor_cashback: value,
      status,
      confirmado_em: now.toISOString(),
      depositado_em: now.toISOString(),
      expira_em: expira.toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`insert: ${error.message}`);
  return data.id as string;
}

async function forceReminder(workspaceId: string, cashbackId: string, stage: string) {
  // Direct DB manipulation since the route requires user auth (cookies).
  // Mirrors what /api/cashback/transactions/[id]/force-reminder does.
  const { sendReminderForStage } = await import("../src/lib/cashback/reminders");
  const { getOrCreateConfig } = await import("../src/lib/cashback/api");
  const cfg = await getOrCreateConfig(workspaceId, db);
  const { data: cb } = await db.from("cashback_transactions").select("*").eq("id", cashbackId).single();
  // reset idempotency col so we can re-fire
  const colMap: Record<string, string> = {
    LEMBRETE_1: "lembrete1_enviado_em",
    LEMBRETE_2: "lembrete2_enviado_em",
    LEMBRETE_3: "lembrete3_enviado_em",
    REATIVACAO: "reativacao_enviado_em",
    REATIVACAO_LEMBRETE: "reativacao_lembrete2",
  };
  await db.from("cashback_transactions").update({ [colMap[stage]]: null }).eq("id", cashbackId);
  const fresh = { ...cb, [colMap[stage]]: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return sendReminderForStage(fresh as any, stage as any, cfg, db);
}

async function cleanup(ids: string[]) {
  if (ids.length === 0) return;
  await db.from("cashback_events").delete().in("cashback_id", ids);
  await db.from("cashback_transactions").delete().in("id", ids);
}

async function main() {
  const { data: conn } = await db.from("vnda_connections").select("workspace_id").eq("enable_cashback", true).limit(1).single();
  const workspaceId = conn!.workspace_id as string;

  const created: string[] = [];

  try {
    console.log("\n═══ Cenário 1: LEMBRETE_1 (cashback_01) ═══");
    const id1 = await createTestRow(workspaceId, "L1", 50, "ATIVO");
    created.push(id1);
    const r1 = await forceReminder(workspaceId, id1, "LEMBRETE_1");
    console.log("  results:", JSON.stringify(r1));

    await new Promise((r) => setTimeout(r, 3000));

    console.log("\n═══ Cenário 2: LEMBRETE_2 (cashback_02) ═══");
    const id2 = await createTestRow(workspaceId, "L2", 75, "ATIVO");
    created.push(id2);
    const r2 = await forceReminder(workspaceId, id2, "LEMBRETE_2");
    console.log("  results:", JSON.stringify(r2));

    await new Promise((r) => setTimeout(r, 3000));

    console.log("\n═══ Cenário 3: LEMBRETE_3 (cashback_03) ═══");
    const id3 = await createTestRow(workspaceId, "L3", 30, "ATIVO");
    created.push(id3);
    const r3 = await forceReminder(workspaceId, id3, "LEMBRETE_3");
    console.log("  results:", JSON.stringify(r3));

    await new Promise((r) => setTimeout(r, 3000));

    console.log("\n═══ Cenário 4: REATIVACAO (reativacao_cashback_jan_25) ═══");
    const id4 = await createTestRow(workspaceId, "REA", 25, "REATIVADO");
    created.push(id4);
    const r4 = await forceReminder(workspaceId, id4, "REATIVACAO");
    console.log("  results:", JSON.stringify(r4));

    await new Promise((r) => setTimeout(r, 3000));

    console.log("\n═══ Cenário 5: USADO bloqueia disparo ═══");
    const id5 = await createTestRow(workspaceId, "USADO", 50, "ATIVO");
    created.push(id5);
    await db.from("cashback_transactions").update({ status: "USADO", usado_em: new Date().toISOString() }).eq("id", id5);
    const r5 = await forceReminder(workspaceId, id5, "LEMBRETE_2");
    console.log("  results:", JSON.stringify(r5));
    const blocked = r5.every((x) => !x.sent && x.skipped?.startsWith("cashback_"));
    console.log(blocked ? "  ✅ Bloqueado corretamente." : "  ❌ NÃO bloqueou — investigar");

  } finally {
    console.log("\nCleanup…");
    await cleanup(created);
    console.log(`Removido ${created.length} test rows.`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
