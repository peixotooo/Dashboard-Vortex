// Seed inicial da lista auto-segmentada por gênero.
//
// Roda DEPOIS de scripts/backfill-customer-gender.ts. Itera os
// clientes do crm_rfm_snapshots e usa syncCustomerToGenderList pra
// preencher a lista — mesma função usada pelo webhook, então
// comportamento é idêntico.
//
// É idempotente: rodadas subsequentes só apendam quem ainda não
// está na lista (RPC append_contact_to_list dedupa por email/phone).
//
// Uso:
//   npx tsx scripts/seed-gender-list.ts --workspace=<uuid>
//   npx tsx scripts/seed-gender-list.ts --workspace=<uuid> --dry-run

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase-admin";
import {
  ensureGenderList,
  syncCustomerToGenderList,
  DEFAULT_FEMALE_LIST,
} from "../src/lib/gender/list-sync";

type SnapshotCustomer = {
  email: string;
  name?: string;
  phone?: string;
};

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

  const { data: snapshot, error: snapErr } = await admin
    .from("crm_rfm_snapshots")
    .select("customers")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (snapErr) throw new Error(`snapshot: ${snapErr.message}`);
  if (!snapshot?.customers) throw new Error("sem snapshot — rodar crm-recompute primeiro");

  const customers = snapshot.customers as SnapshotCustomer[];
  console.log(`${customers.length} clientes no snapshot`);

  if (dryRun) {
    // Simula via inferência local pra contar quantos cairiam
    const { inferGender } = await import("../src/lib/gender/inference");
    let wouldAppend = 0;
    for (const c of customers) {
      const r = inferGender(c.name ?? "", c.email);
      if (r.gender === "female" && (r.confidence === "high" || r.confidence === "medium")) {
        wouldAppend++;
      }
    }
    console.log(`(dry-run) Apendaria ${wouldAppend} clientes na lista.`);
    return;
  }

  // Garante a lista existe antes do loop
  const list = await ensureGenderList(admin, workspaceId, DEFAULT_FEMALE_LIST);
  console.log(`Lista "${list.name}" (id=${list.id}, total atual=${list.total_count})`);

  const counters = { appended: 0, duplicate: 0, skipped: 0, errors: 0 };
  let i = 0;
  for (const c of customers) {
    i++;
    if (i % 1000 === 0) {
      console.log(`  ${i}/${customers.length} — appended=${counters.appended}, dup=${counters.duplicate}, skip=${counters.skipped}, err=${counters.errors}`);
    }
    try {
      const r = await syncCustomerToGenderList(admin, workspaceId, {
        name: c.name ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
      });
      if (r.status === "appended") counters.appended++;
      else if (r.status === "duplicate") counters.duplicate++;
      else counters.skipped++;
    } catch (e) {
      counters.errors++;
      if (counters.errors <= 5) {
        console.warn(`  erro em ${c.email}:`, e instanceof Error ? e.message : e);
      }
    }
  }

  console.log("\nResumo:");
  console.log(`  appended: ${counters.appended}`);
  console.log(`  duplicate: ${counters.duplicate}`);
  console.log(`  skipped: ${counters.skipped}`);
  console.log(`  errors: ${counters.errors}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
