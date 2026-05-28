// Backfill da inferência de gênero por workspace.
//
// Estratégia: lê crm_rfm_snapshots.customers (já está deduplicado por
// email — uma linha por cliente) ao invés de paginar crm_vendas, que
// teria N linhas por cliente. Roda inferGender(name, email) por
// cliente e faz upsert em chunks em customer_gender_inference.
//
// Uso:
//   npx tsx scripts/backfill-customer-gender.ts            → todos workspaces
//   npx tsx scripts/backfill-customer-gender.ts --workspace=<uuid>
//   npx tsx scripts/backfill-customer-gender.ts --dry-run  → não persiste
//
// Não é idempotente do ponto de vista de updated_at — toda execução
// sobrescreve a inferência. Isso é proposital: se a gente expandir o
// dicionário (IBGE_NAMES), o backfill seguinte recupera nomes que
// antes caíram em 'unknown'.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase-admin";
import { inferGender } from "../src/lib/gender/inference";

type SnapshotCustomer = {
  email: string;
  name?: string;
};

type InferenceRow = {
  workspace_id: string;
  email: string;
  inferred_gender: string;
  confidence: string;
  source: string;
  matched_name: string | null;
  female_ratio: number | null;
};

const UPSERT_CHUNK = 500;

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

async function processWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  workspaceName: string,
  dryRun: boolean,
) {
  console.log(`\n→ ${workspaceName} (${workspaceId})`);
  const { data: snapshot, error } = await admin
    .from("crm_rfm_snapshots")
    .select("customers")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    console.log(`  ⚠ erro lendo snapshot: ${error.message}`);
    return;
  }
  if (!snapshot?.customers) {
    console.log(`  (sem snapshot — pula)`);
    return;
  }

  const customers = snapshot.customers as SnapshotCustomer[];
  if (!Array.isArray(customers) || customers.length === 0) {
    console.log(`  (snapshot vazio — pula)`);
    return;
  }

  console.log(`  ${customers.length} clientes no snapshot — inferindo...`);

  const stats = {
    female_high: 0, female_medium: 0, female_low: 0,
    male_high: 0, male_medium: 0, male_low: 0,
    unknown: 0,
  };

  const rows: InferenceRow[] = [];
  for (const c of customers) {
    if (!c.email) continue;
    const r = inferGender(c.name ?? "", c.email);
    rows.push({
      workspace_id: workspaceId,
      email: c.email.trim().toLowerCase(),
      inferred_gender: r.gender,
      confidence: r.confidence,
      source: r.source,
      matched_name: r.matchedName,
      female_ratio: r.femaleRatio,
    });
    const key = r.gender === "unknown" ? "unknown" : `${r.gender}_${r.confidence}`;
    if (key in stats) (stats as Record<string, number>)[key]++;
  }

  console.log("  Distribuição:");
  console.log(`    ♀ alta:  ${stats.female_high}`);
  console.log(`    ♀ média: ${stats.female_medium}`);
  console.log(`    ♀ baixa: ${stats.female_low}`);
  console.log(`    ♂ alta:  ${stats.male_high}`);
  console.log(`    ♂ média: ${stats.male_medium}`);
  console.log(`    ♂ baixa: ${stats.male_low}`);
  console.log(`    ?? unknown: ${stats.unknown}`);

  const femaleHighMedium = stats.female_high + stats.female_medium;
  console.log(`  → segmento "mulheres" (alta+média): ${femaleHighMedium} (${((femaleHighMedium / customers.length) * 100).toFixed(1)}%)`);

  if (dryRun) {
    console.log("  (dry-run — não persistindo)");
    return;
  }

  // Upsert em chunks pra não estourar payload
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error: upErr } = await admin
      .from("customer_gender_inference")
      .upsert(chunk, { onConflict: "workspace_id,email" });
    if (upErr) {
      console.log(`  ⚠ erro upsert chunk ${i / UPSERT_CHUNK}: ${upErr.message}`);
      return;
    }
  }
  console.log(`  ✓ ${rows.length} linhas upserted`);
}

async function main() {
  const { workspaceId, dryRun } = parseArgs();
  const admin = createAdminClient();

  let workspaces: Array<{ id: string; name: string }> = [];
  if (workspaceId) {
    const { data, error } = await admin
      .from("workspaces").select("id, name").eq("id", workspaceId).single();
    if (error || !data) throw new Error(`workspace ${workspaceId} não encontrado: ${error?.message}`);
    workspaces = [data];
  } else {
    const { data, error } = await admin
      .from("workspaces").select("id, name").order("name");
    if (error) throw new Error(error.message);
    workspaces = data ?? [];
  }

  console.log(`Backfilling ${workspaces.length} workspace(s)${dryRun ? " (dry-run)" : ""}`);
  for (const ws of workspaces) {
    await processWorkspace(admin, ws.id, ws.name, dryRun);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
