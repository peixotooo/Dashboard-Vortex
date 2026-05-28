// Seed da lista auto-segmentada por gênero — versão snapshot-independent.
//
// Lê customer_gender_inference (já populado pelo backfill) e enriquece
// com phone+name vindo do crm_vendas (linha mais recente por email).
// Mais robusto que depender de snapshot, que pode ser invalidado a
// qualquer momento pelo webhook VNDA.
//
// Uso:
//   npx tsx scripts/seed-gender-list.ts --workspace=<uuid>
//   npx tsx scripts/seed-gender-list.ts --workspace=<uuid> --dry-run

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase-admin";
import {
  ensureGenderList,
  DEFAULT_FEMALE_LIST,
  type GenderListConfig,
} from "../src/lib/gender/list-sync";

type AdminClient = ReturnType<typeof createAdminClient>;

const PAGE = 1000;       // página do customer_gender_inference
const VENDA_BATCH = 200; // batch do .in('email', ...) lookup

function parseArgs(): { workspaceId?: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  let workspaceId: string | undefined;
  let dryRun = false;
  for (const a of args) {
    if (a.startsWith("--workspace=")) workspaceId = a.slice("--workspace=".length);
    if (a === "--dry-run") dryRun = true;
  }
  return { workspaceId, dryRun };
}

async function fetchAllFemaleEmails(
  admin: AdminClient,
  workspaceId: string,
  config: GenderListConfig,
): Promise<string[]> {
  const confidences = config.min_confidence === "high"
    ? ["high"]
    : ["high", "medium"];

  const out: string[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("customer_gender_inference")
      .select("email")
      .eq("workspace_id", workspaceId)
      .eq("inferred_gender", config.gender)
      .in("confidence", confidences)
      .order("email", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetch inference: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) out.push((r as { email: string }).email);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function fetchLatestContactByEmail(
  admin: AdminClient,
  workspaceId: string,
  emails: string[],
): Promise<Map<string, { name: string | null; phone: string | null }>> {
  const map = new Map<string, { name: string | null; phone: string | null; ts: number }>();

  for (let i = 0; i < emails.length; i += VENDA_BATCH) {
    const chunk = emails.slice(i, i + VENDA_BATCH);
    const { data, error } = await admin
      .from("crm_vendas")
      .select("email, cliente, telefone, data_compra")
      .eq("workspace_id", workspaceId)
      .in("email", chunk);
    if (error) throw new Error(`fetch crm_vendas chunk ${i}: ${error.message}`);
    if (!data) continue;

    for (const row of data) {
      const r = row as { email: string; cliente: string | null; telefone: string | null; data_compra: string | null };
      const email = (r.email || "").trim().toLowerCase();
      if (!email) continue;
      const ts = r.data_compra ? new Date(r.data_compra).getTime() : 0;
      const cur = map.get(email);
      if (!cur || ts > cur.ts) {
        map.set(email, { name: r.cliente, phone: r.telefone, ts });
      }
    }
  }

  const out = new Map<string, { name: string | null; phone: string | null }>();
  for (const [email, v] of map) out.set(email, { name: v.name, phone: v.phone });
  return out;
}

async function main() {
  const { workspaceId, dryRun } = parseArgs();
  if (!workspaceId) {
    console.error("Uso: npx tsx scripts/seed-gender-list.ts --workspace=<uuid>");
    process.exit(1);
  }

  const admin = createAdminClient();

  const { data: ws, error: wsErr } = await admin
    .from("workspaces").select("id, name").eq("id", workspaceId).single();
  if (wsErr || !ws) throw new Error(`workspace ${workspaceId} não encontrado`);
  console.log(`Workspace: ${ws.name} (${ws.id})${dryRun ? " (dry-run)" : ""}`);

  console.log("Carregando emails de mulheres (high+medium) do customer_gender_inference...");
  const emails = await fetchAllFemaleEmails(admin, workspaceId, DEFAULT_FEMALE_LIST);
  console.log(`${emails.length} emails alvo.`);

  if (emails.length === 0) {
    console.log("Nada pra apendar — rodar scripts/backfill-customer-gender.ts primeiro?");
    return;
  }

  console.log("Buscando phone/name mais recente de cada email em crm_vendas...");
  const contactMap = await fetchLatestContactByEmail(admin, workspaceId, emails);
  console.log(`${contactMap.size}/${emails.length} emails com dado de contato.`);

  if (dryRun) {
    console.log(`(dry-run) Apendaria ${emails.length} clientes na lista.`);
    return;
  }

  const list = await ensureGenderList(admin, workspaceId, DEFAULT_FEMALE_LIST);
  console.log(`Lista "${list.name}" (id=${list.id}, total atual=${list.total_count})`);

  const counters = { appended: 0, duplicate: 0, no_data: 0, errors: 0 };
  let i = 0;
  for (const email of emails) {
    i++;
    if (i % 500 === 0) {
      console.log(`  ${i}/${emails.length} — appended=${counters.appended}, dup=${counters.duplicate}, no_data=${counters.no_data}, err=${counters.errors}`);
    }
    const c = contactMap.get(email);
    try {
      const { data: appended, error } = await admin.rpc("append_contact_to_list", {
        p_list_id: list.id,
        p_email: email,
        p_phone: c?.phone || null,
        p_name: c?.name || null,
      });
      if (error) throw error;
      if (appended) counters.appended++;
      else counters.duplicate++;
      if (!c) counters.no_data++;
    } catch (e) {
      counters.errors++;
      if (counters.errors <= 5) {
        console.warn(`  erro em ${email}:`, e instanceof Error ? e.message : e);
      }
    }
  }

  console.log("\nResumo:");
  console.log(`  appended: ${counters.appended}`);
  console.log(`  duplicate: ${counters.duplicate}`);
  console.log(`  no_data (só email, sem phone/name em crm_vendas): ${counters.no_data}`);
  console.log(`  errors: ${counters.errors}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
