// Teste de paridade SenseBoard × Vortex.
// Gabarito = números REAIS capturados das telas do SenseBoard em 2026-07-08,
// na mesma sessão do export (docs/senseboard-migracao-sdd.md §6, Fase 1).
//
//   npx tsx scripts/senseboard-parity.ts --csv   → agrega direto do CSV exportado
//                                                  (valida a SEMÂNTICA do motor)
//   npx tsx scripts/senseboard-parity.ts --db    → agrega do Supabase (fin_entries)
//                                                  (valida a IMPORTAÇÃO)
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import { loadEntries, RawEntry, WORKSPACE_ID } from "./senseboard-lib";

// ---------- Gabarito (telas de 08/07/2026, ano 2026, "Todos os lançamentos") ----------
// DRE Anual Comparativo — linha (+) Receita de Vendas, jan→jul (competência):
const DRE_RECEITA_2026 = [529534.7, 541849.51, 619811.15, 620197.65, 541658.69, 562670.76, 243126.81];
// DRE Anual Comparativo — linha (-) Deduções de Vendas, jan→jun:
const DRE_DEDUCOES_2026 = [42331.87, 50404.71, 41214.87, 50233.75, 31952.33, 36252.51];
// DFC Dashboard — Consolidado mês a mês (Recebíveis | Saídas), jan→dez:
const DFC_ENTRADAS_2026 = [1014539.52, 993065.56, 1181940.91, 1143910.54, 1031057.03, 1077705.84, 377525.75, 0, 0, 0, 0, 0];
const DFC_SAIDAS_2026 = [795422.96, 678327.12, 821916.18, 818503.67, 704187.87, 767254.42, 641504.95, 381483.68, 263035.42, 213311.66, 175851.83, 187851.83];
const DFC_TOTAL_ENTRADAS = 6819745.15;
const DFC_TOTAL_SAIDAS = 6448651.59;

const TOL = 0.02;

interface Agg {
  dreReceita: number[]; // por mês (0-11), competência 2026, categoria Receita de Vendas
  dreDeducoes: number[];
  dfcEntradas: number[]; // por mês, base caixa: paid_at || due_date, sem transfer/depreciação
  dfcSaidas: number[];
}

function emptyAgg(): Agg {
  return {
    dreReceita: Array(12).fill(0),
    dreDeducoes: Array(12).fill(0),
    dfcEntradas: Array(12).fill(0),
    dfcSaidas: Array(12).fill(0),
  };
}

function month2026(iso: string | null): number | null {
  if (!iso || !iso.startsWith("2026-")) return null;
  return parseInt(iso.slice(5, 7), 10) - 1;
}

function accumulate(agg: Agg, e: {
  competence: string | null; due: string | null; paidAt: string | null;
  amount: number; flow: number; kind: string; category: string; needsReview: boolean;
}) {
  // DRE: competência, sem transferências e sem "Não Classificado"
  // (depreciação e provisões/accrual ENTRAM na DRE)
  if (e.kind !== "transfer" && !e.needsReview) {
    const m = month2026(e.competence);
    if (m !== null) {
      if (e.category === "Receita de Vendas") agg.dreReceita[m] += e.amount;
      if (e.category === "Deduções de Vendas") agg.dreDeducoes[m] += e.amount;
    }
  }
  // DFC: caixa (pago → data pagamento; pendente → vencimento); só kind normal
  // (fora: transferências, depreciação e provisões de CMV)
  if (e.kind === "normal") {
    const m = month2026(e.paidAt || e.due);
    if (m !== null) {
      if (e.flow === 1) agg.dfcEntradas[m] += e.amount;
      else agg.dfcSaidas[m] += e.amount;
    }
  }
}

async function fromCsv(): Promise<Agg> {
  const { splitPath } = await import("./senseboard-lib");
  const agg = emptyAgg();
  for (const e of loadEntries() as RawEntry[]) {
    accumulate(agg, { ...e, category: splitPath(e.classificationPath).category });
  }
  return agg;
}

async function fromDb(): Promise<Agg> {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: cls } = await sb
    .from("fin_classifications")
    .select("id, category")
    .eq("workspace_id", WORKSPACE_ID);
  const catById = new Map((cls || []).map((c) => [c.id, c.category]));

  const agg = emptyAgg();
  const PAGE = 5000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("fin_entries")
      .select("competence_date, due_date, paid_at, amount, flow, kind, needs_review, classification_id")
      .eq("workspace_id", WORKSPACE_ID)
      .is("deleted_at", null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data) {
      accumulate(agg, {
        competence: r.competence_date,
        due: r.due_date,
        paidAt: r.paid_at,
        amount: Number(r.amount),
        flow: r.flow,
        kind: r.kind,
        needsReview: r.needs_review,
        category: catById.get(r.classification_id) || "?",
      });
    }
    if (data.length < PAGE) break;
  }
  return agg;
}

function check(label: string, expected: number[], actual: number[]): number {
  let fails = 0;
  expected.forEach((exp, m) => {
    const act = actual[m];
    const ok = Math.abs(act - exp) <= TOL;
    if (!ok) fails++;
    console.log(
      `${ok ? "  ✅" : "  ❌"} ${label} ${String(m + 1).padStart(2, "0")}/2026  esperado ${exp.toFixed(2).padStart(13)}  obtido ${act.toFixed(2).padStart(13)}  Δ ${(act - exp).toFixed(2)}`
    );
  });
  return fails;
}

(async () => {
  const mode = process.argv.includes("--db") ? "db" : "csv";
  console.log(`Paridade SenseBoard — fonte: ${mode.toUpperCase()}\n`);
  const agg = mode === "db" ? await fromDb() : await fromCsv();

  let fails = 0;
  console.log("DRE (competência) — Receita de Vendas:");
  fails += check("receita", DRE_RECEITA_2026, agg.dreReceita);
  console.log("\nDRE (competência) — Deduções de Vendas:");
  fails += check("deduções", DRE_DEDUCOES_2026, agg.dreDeducoes);
  console.log("\nDFC (caixa: pagamento||vencimento) — Entradas:");
  fails += check("entradas", DFC_ENTRADAS_2026, agg.dfcEntradas);
  console.log("\nDFC — Saídas:");
  fails += check("saídas", DFC_SAIDAS_2026, agg.dfcSaidas);

  const te = agg.dfcEntradas.reduce((a, b) => a + b, 0);
  const ts = agg.dfcSaidas.reduce((a, b) => a + b, 0);
  console.log(`\nTotais DFC 2026: entradas ${te.toFixed(2)} (esperado ${DFC_TOTAL_ENTRADAS}) | saídas ${ts.toFixed(2)} (esperado ${DFC_TOTAL_SAIDAS})`);
  if (Math.abs(te - DFC_TOTAL_ENTRADAS) > TOL) fails++;
  if (Math.abs(ts - DFC_TOTAL_SAIDAS) > TOL) fails++;

  console.log(fails === 0 ? "\n🎯 PARIDADE TOTAL" : `\n💥 ${fails} divergência(s)`);
  process.exit(fails === 0 ? 0 : 1);
})();
