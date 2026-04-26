// Verifica overlap de telefones entre os dois clones recentes
// e impacto do cooldown (campanhas anteriores) sobre eles.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase-admin";

const PAGE = 1000;

async function fetchAllPhones(campaignId: string): Promise<Set<string>> {
  const admin = createAdminClient();
  const phones = new Set<string>();
  let from = 0;
  while (true) {
    const { data } = await admin
      .from("wa_messages")
      .select("phone")
      .eq("campaign_id", campaignId)
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    for (const r of data) phones.add((r as { phone: string }).phone.replace(/\D/g, ""));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return phones;
}

async function main() {
  const admin = createAdminClient();

  // Pega o workspace Bulking
  const { data: ws } = await admin
    .from("workspaces")
    .select("id, name")
    .ilike("name", "%bulking%")
    .limit(5);
  console.log("Workspaces encontrados:", ws);
  const bulking = (ws || [])[0];
  if (!bulking) throw new Error("Workspace Bulking nao encontrado");

  // Pega as campanhas mais recentes
  const { data: campaigns } = await admin
    .from("wa_campaigns")
    .select("id, name, status, scheduled_at, total_messages, sent_count, delivered_count, created_at")
    .eq("workspace_id", bulking.id)
    .order("created_at", { ascending: false })
    .limit(10);

  console.log("\n=== 10 campanhas mais recentes ===");
  for (const c of campaigns || []) {
    console.log(
      `${c.created_at?.slice(0, 16)} | ${c.status.padEnd(10)} | tot=${String(c.total_messages).padStart(5)} sent=${String(c.sent_count).padStart(5)} deliv=${String(c.delivered_count).padStart(5)} | sched=${c.scheduled_at || "-"} | ${c.name}`
    );
  }

  // Pega as 2 mais recentes scheduled (os clones)
  const scheduled = (campaigns || []).filter((c) => c.status === "scheduled").slice(0, 2);
  if (scheduled.length < 2) {
    console.log("\nMenos de 2 campanhas scheduled — esperando 2 clones recentes.");
    return;
  }
  const [a, b] = scheduled;
  console.log(`\nComparando overlap entre:\n  A) ${a.name} (${a.id})\n  B) ${b.name} (${b.id})`);

  const [phonesA, phonesB] = await Promise.all([fetchAllPhones(a.id), fetchAllPhones(b.id)]);
  const overlap = [...phonesA].filter((p) => phonesB.has(p));

  console.log(`\nA tem ${phonesA.size} telefones unicos`);
  console.log(`B tem ${phonesB.size} telefones unicos`);
  console.log(`Overlap A∩B: ${overlap.length} telefones receberao MENSAGEM 2x se ambas dispararem juntas`);

  if (overlap.length > 0 && overlap.length <= 10) {
    console.log("Exemplos de overlap:", overlap);
  }

  // Cooldown impact: quantos telefones nas duas novas campanhas tem mensagens com status sent/delivered/read nos ultimos 7 dias?
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  const allPhones = new Set([...phonesA, ...phonesB]);
  console.log(`\nCheckando cooldown 7d para ${allPhones.size} telefones unicos das duas campanhas...`);

  // Pega TODOS os phones que receberam sent/delivered/read nos ultimos 7 dias
  const cooldownPhones = new Set<string>();
  let from = 0;
  while (true) {
    const { data } = await admin
      .from("wa_messages")
      .select("phone")
      .eq("workspace_id", bulking.id)
      .in("status", ["sent", "delivered", "read"])
      .gte("sent_at", cutoff.toISOString())
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    for (const r of data) cooldownPhones.add((r as { phone: string }).phone.replace(/\D/g, ""));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Total de telefones em cooldown 7d na conta: ${cooldownPhones.size}`);

  let bothInCooldown = 0;
  for (const p of allPhones) if (cooldownPhones.has(p)) bothInCooldown++;
  console.log(
    `\n${bothInCooldown}/${allPhones.size} telefones dos clones JA receberam algo (status sent/delivered/read) nos ultimos 7 dias`
  );
  console.log(
    `>> O cron NAO aplica cooldown (so checa wa_exclusions). filterContacts so roda no POST /campaigns inicial.`
  );
  console.log(
    `>> Logo: como o clone bypassa filterContacts, esses ${bothInCooldown} VAO receber de novo na proxima execucao.`
  );

  // Quantos estao na lista permanente wa_exclusions?
  const { count: exclusionsCount } = await admin
    .from("wa_exclusions")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", bulking.id);
  console.log(`\nLista permanente wa_exclusions: ${exclusionsCount || 0} telefones (esses vao ser bloqueados pelo cron)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
