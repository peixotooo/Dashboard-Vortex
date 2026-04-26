// Remove telefones duplicados entre dois clones recentes (mantém na earlier).
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase-admin";

const PAGE = 1000;

async function fetchAllPhones(campaignId: string): Promise<Map<string, string>> {
  // Map<normalized phone, message id>
  const admin = createAdminClient();
  const out = new Map<string, string>();
  let from = 0;
  while (true) {
    const { data } = await admin
      .from("wa_messages")
      .select("id, phone")
      .eq("campaign_id", campaignId)
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    for (const r of data as { id: string; phone: string }[]) {
      out.set(r.phone.replace(/\D/g, ""), r.id);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function main() {
  const admin = createAdminClient();

  // Pega os 2 clones mais recentes (status=scheduled)
  const { data: ws } = await admin
    .from("workspaces")
    .select("id")
    .ilike("name", "%bulking%")
    .limit(1)
    .single();
  if (!ws) throw new Error("workspace nao encontrado");

  const { data: scheduled } = await admin
    .from("wa_campaigns")
    .select("id, name, scheduled_at, total_messages")
    .eq("workspace_id", ws.id)
    .eq("status", "scheduled")
    .order("created_at", { ascending: false })
    .limit(2);

  if (!scheduled || scheduled.length < 2) throw new Error("Esperando 2 campanhas scheduled");

  // earlier = aquela com scheduled_at menor
  const sorted = [...scheduled].sort(
    (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
  );
  const earlier = sorted[0];
  const later = sorted[1];
  console.log(`Earlier: ${earlier.name} @ ${earlier.scheduled_at}`);
  console.log(`Later:   ${later.name} @ ${later.scheduled_at}`);

  const [earlierPhones, laterPhones] = await Promise.all([
    fetchAllPhones(earlier.id),
    fetchAllPhones(later.id),
  ]);
  console.log(`Earlier tem ${earlierPhones.size} telefones`);
  console.log(`Later   tem ${laterPhones.size} telefones`);

  // IDs no later que tambem estao no earlier => remover do later
  const toDelete: string[] = [];
  for (const [phone, msgId] of laterPhones.entries()) {
    if (earlierPhones.has(phone)) toDelete.push(msgId);
  }
  console.log(`\nVou remover ${toDelete.length} mensagens duplicadas da campanha LATER (${later.name})`);
  if (toDelete.length === 0) {
    console.log("Nada a fazer.");
    return;
  }

  // Delete em chunks
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 200) {
    const chunk = toDelete.slice(i, i + 200);
    const { error } = await admin.from("wa_messages").delete().in("id", chunk);
    if (error) throw new Error(error.message);
    deleted += chunk.length;
  }
  console.log(`Removidas ${deleted} linhas de wa_messages.`);

  // Atualiza total_messages do later
  const newTotal = later.total_messages - deleted;
  await admin
    .from("wa_campaigns")
    .update({ total_messages: newTotal })
    .eq("id", later.id);
  console.log(`total_messages de "${later.name}" atualizado: ${later.total_messages} -> ${newTotal}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
