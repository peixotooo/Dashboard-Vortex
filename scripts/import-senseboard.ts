// Importa o export do SenseBoard (output/senseboard-export/) para as tabelas fin_*.
// SDD: docs/senseboard-migracao-sdd.md — requer migration-135 aplicada.
//
//   npx tsx scripts/import-senseboard.ts            → dry-run (só valida e mostra o plano)
//   npx tsx scripts/import-senseboard.ts --apply    → importa (substitui carga anterior
//                                                     source='senseboard' do workspace)
//
// Idempotente: parceiros/contas/classificações são upsert por chave natural;
// lançamentos são FULL REFRESH da fonte 'senseboard' (estratégia de re-import
// semanal do delta durante o dual-run).
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import {
  EXPORT_DIR, WORKSPACE_ID, loadEntries, loadCadastroClassifications, splitPath,
} from "./senseboard-lib";

const APPLY = process.argv.includes("--apply");
const CHUNK = 1000;

(async () => {
  const entries = loadEntries();
  const cadastro = loadCadastroClassifications();
  const contas = JSON.parse(
    fs.readFileSync(path.join(EXPORT_DIR, "contas-bancarias-2026-07-08.json"), "utf8")
  ).contas as { sigla: string; banco: string; agencia: string; conta: string }[];
  const dePara = JSON.parse(
    fs.readFileSync(path.join(EXPORT_DIR, "de-para-classificacoes-2026-07-08.json"), "utf8")
  ).mapeamentos as { de: string; para: string }[];

  // ---------- resolução de classificações (por caminho completo) ----------
  const byPath = new Map(cadastro.map((c) => [c.reconstructedPath, c]));
  const distinctPaths = [...new Set(entries.map((e) => e.classificationPath))];
  const classifications = distinctPaths.map((p) => {
    const active = byPath.get(p);
    const parsed = active
      ? { category: active.category, subcategory: active.subcategory, name: active.name }
      : splitPath(p);
    // flow por voto majoritário dos lançamentos (autoritativo — cadastro só tem 65)
    const flows = entries.filter((e) => e.classificationPath === p).map((e) => e.flow);
    const flow = flows.filter((f) => f === 1).length > flows.length / 2 ? 1 : -1;
    return {
      workspace_id: WORKSPACE_ID,
      path: p,
      name: parsed.name,
      category: parsed.category,
      subcategory: parsed.subcategory,
      flow,
      is_transfer: p.includes("Transferências Entre Contas"),
      is_depreciation: p.endsWith("Depreciação"),
      is_active: !!active,
    };
  });

  const partners = [...new Set(entries.map((e) => e.partner).filter(Boolean))].map((name) => ({
    workspace_id: WORKSPACE_ID,
    name,
  }));

  const stats = {
    lancamentos: entries.length,
    classificacoes: classifications.length,
    ativas: classifications.filter((c) => c.is_active).length,
    parceiros: partners.length,
    contas: contas.length,
    porKind: entries.reduce<Record<string, number>>((a, e) => ((a[e.kind] = (a[e.kind] || 0) + 1), a), {}),
    needsReview: entries.filter((e) => e.needsReview).length,
    semConta: entries.filter((e) => !e.accountCode).length,
    semCompetencia: entries.filter((e) => !e.competence).length,
  };
  console.log("Plano de importação:", JSON.stringify(stats, null, 2));
  if (!APPLY) {
    console.log("\nDry-run. Rode com --apply para importar.");
    return;
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  // ---------- lote ----------
  const { data: batch, error: bErr } = await sb
    .from("fin_import_batches")
    .insert({
      workspace_id: WORKSPACE_ID,
      source: "senseboard",
      filename: "lancamentos-completo-2026-07-08.csv",
      row_count: entries.length,
      meta: stats as any,
    })
    .select("id")
    .single();
  if (bErr) throw bErr;
  console.log("batch:", batch.id);

  // ---------- contas ----------
  const { error: cErr } = await sb.from("fin_bank_accounts").upsert(
    contas.map((c) => ({
      workspace_id: WORKSPACE_ID,
      code: c.sigla,
      bank_name: c.banco,
      agency: c.agencia,
      account_number: c.conta,
    })),
    { onConflict: "workspace_id,code" }
  );
  if (cErr) throw cErr;

  // ---------- parceiros (chunks) ----------
  for (let k = 0; k < partners.length; k += CHUNK) {
    const { error } = await sb.from("fin_partners").upsert(partners.slice(k, k + CHUNK), {
      onConflict: "workspace_id,name",
    });
    if (error) throw error;
  }

  // ---------- classificações ----------
  const { error: clErr } = await sb.from("fin_classifications").upsert(classifications, {
    onConflict: "workspace_id,path",
  });
  if (clErr) throw clErr;

  // ---------- mapas id ----------
  const ids = async (table: string, key: string) => {
    const map = new Map<string, string>();
    for (let from = 0; ; from += CHUNK) {
      const { data, error } = await sb
        .from(table)
        .select(`id, ${key}`)
        .eq("workspace_id", WORKSPACE_ID)
        .range(from, from + CHUNK - 1);
      if (error) throw error;
      for (const r of data || []) map.set((r as any)[key], (r as any).id);
      if (!data || data.length < CHUNK) break;
    }
    return map;
  };
  const partnerId = await ids("fin_partners", "name");
  const accountId = await ids("fin_bank_accounts", "code");
  const classId = await ids("fin_classifications", "path");

  // ---------- de>para (aliases; folha do cadastro → classificação) ----------
  const byName = new Map(
    classifications.filter((c) => c.is_active).map((c) => [c.name, c.path])
  );
  const aliases = dePara
    .map((m) => {
      const p = byName.get(m.para);
      return p ? { workspace_id: WORKSPACE_ID, alias_text: m.de, classification_id: classId.get(p)! } : null;
    })
    .filter(Boolean) as any[];
  const unmatched = dePara.length - aliases.length;
  if (aliases.length) {
    const { error } = await sb.from("fin_classification_aliases").upsert(aliases, {
      onConflict: "workspace_id,alias_text",
    });
    if (error) throw error;
  }
  console.log(`aliases: ${aliases.length} (${unmatched} sem correspondência ativa — ok, resolver depois)`);

  // ---------- full refresh dos lançamentos da fonte ----------
  console.log("removendo carga senseboard anterior…");
  for (;;) {
    const { data, error } = await sb
      .from("fin_entries")
      .delete()
      .eq("workspace_id", WORKSPACE_ID)
      .eq("source", "senseboard")
      .neq("import_batch_id", batch.id)
      .select("id")
      .limit(5000);
    if (error) throw error;
    if (!data?.length) break;
    process.stdout.write(`  -${data.length}`);
  }

  console.log("\ninserindo lançamentos…");
  let inserted = 0;
  for (let k = 0; k < entries.length; k += CHUNK) {
    const rows = entries.slice(k, k + CHUNK).map((e) => ({
      workspace_id: WORKSPACE_ID,
      doc_number: e.docNumber || null,
      description: e.description || null,
      observation: e.observation || null,
      partner_id: partnerId.get(e.partner) || null,
      classification_id: classId.get(e.classificationPath)!,
      bank_account_id: e.accountCode ? accountId.get(e.accountCode) || null : null,
      competence_date: e.competence,
      due_date: e.due,
      paid_at: e.paidAt,
      amount: e.amount,
      flow: e.flow,
      kind: e.kind,
      needs_review: e.needsReview,
      source: "senseboard",
      source_created_at: e.createdAt,
      source_created_by: e.createdBy || null,
      source_updated_at: e.updatedAt,
      source_updated_by: e.updatedBy || null,
      import_batch_id: batch.id,
    }));
    const { error } = await sb.from("fin_entries").insert(rows);
    if (error) throw error;
    inserted += rows.length;
    if (inserted % 10000 < CHUNK) console.log(`  ${inserted}/${entries.length}`);
  }

  await sb.from("fin_import_batches").update({ status: "done", row_count: inserted }).eq("id", batch.id);
  console.log(`\n✅ importado: ${inserted} lançamentos. Agora rode: npx tsx scripts/senseboard-parity.ts --db`);
})().catch((e) => {
  console.error("💥", e.message || e);
  process.exit(1);
});
