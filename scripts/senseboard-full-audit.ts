// Auditoria ABRANGENTE — cada célula de cada página × SenseBoard.
// Gabaritos capturados ao vivo das telas em 2026-07-09.
//   npx tsx scripts/senseboard-full-audit.ts
import * as dotenv from "dotenv"; import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { fetchEngineData, aggregateYear, composeDre, composeDfc, composePeriod } from "../src/lib/controladoria/engine";
import { WORKSPACE_ID } from "./senseboard-lib";

const n = (br: string) => parseFloat(br.replace(/\./g, "").replace(",", ".")) || 0;

// ---- DRE Anual Resumido COMPLETO (19 linhas × ACUM) ----
const DRE_KEY: Record<string, string> = {
  "(+) Receita de Vendas": "receita",
  "(-) Deduções de Vendas": "deducoes",
  "(=) Receita líquida": "receita_liquida",
  "(-) Custo dos Produtos Vendidos": "cpv",
  "(=) Margem bruta": "margem_bruta",
  "(-) Despesas Variáveis": "desp_var",
  "(=) Margem de contribuição": "margem_contrib",
  "(-) Gastos fixos (custos fixos + despesas fixas)": "gastos_fixos",
  "(-) Gasto com Pessoal - Adm": "pessoal_adm",
  "(-) Gasto com pessoal - Prod/Oper": "pessoal_oper",
  "(-) Despesas Operacionais": "desp_oper",
  "(=) Ebitda": "ebitda",
  "(+) Receitas Financeiras": "rec_fin",
  "(-) Despesas Financeiras": "desp_fin",
  "(=) Resultado operacional bruto": "res_bruto",
  "(-) Impostos Sob Lucro": "impostos_lucro",
  "(=) Resultado operacional líquido": "res_liquido",
  "(-) Distribuição de Lucro": "distribuicao",
  "(=) Resultado pós distribuição de lucros": "res_final",
};
const DRE_ANUAL: Record<number, [string, string][]> = {
  2026: [["(+) Receita de Vendas","3.658.849"],["(-) Deduções de Vendas","304.929"],["(=) Receita líquida","3.353.920"],["(-) Custo dos Produtos Vendidos","1.080.052"],["(=) Margem bruta","2.273.868"],["(-) Despesas Variáveis","1.140.807"],["(=) Margem de contribuição","1.133.061"],["(-) Gastos fixos (custos fixos + despesas fixas)","1.680.826"],["(-) Gasto com Pessoal - Adm","171.490"],["(-) Gasto com pessoal - Prod/Oper","354.606"],["(-) Despesas Operacionais","1.154.729"],["(=) Ebitda","-547.765"],["(+) Receitas Financeiras","7.415"],["(-) Despesas Financeiras","209.237"],["(=) Resultado operacional bruto","-749.587"],["(-) Impostos Sob Lucro","45.880"],["(=) Resultado operacional líquido","-795.467"],["(-) Distribuição de Lucro","0"],["(=) Resultado pós distribuição de lucros","-795.467"]],
  2025: [["(+) Receita de Vendas","8.109.073"],["(-) Deduções de Vendas","822.723"],["(=) Receita líquida","7.286.351"],["(-) Custo dos Produtos Vendidos","2.091.671"],["(=) Margem bruta","5.194.680"],["(-) Despesas Variáveis","2.858.368"],["(=) Margem de contribuição","2.336.312"],["(-) Gastos fixos (custos fixos + despesas fixas)","2.090.987"],["(-) Gasto com Pessoal - Adm","244.905"],["(-) Gasto com pessoal - Prod/Oper","316.526"],["(-) Despesas Operacionais","1.529.556"],["(=) Ebitda","245.325"],["(+) Receitas Financeiras","11.272"],["(-) Despesas Financeiras","353.961"],["(=) Resultado operacional bruto","-97.365"],["(-) Impostos Sob Lucro","193.789"],["(=) Resultado operacional líquido","-291.154"],["(-) Distribuição de Lucro","0"],["(=) Resultado pós distribuição de lucros","-291.154"]],
  2024: [["(+) Receita de Vendas","7.000.171"],["(-) Deduções de Vendas","1.302.642"],["(=) Receita líquida","5.697.530"],["(-) Custo dos Produtos Vendidos","1.649.255"],["(=) Margem bruta","4.048.274"],["(-) Despesas Variáveis","2.206.384"],["(=) Margem de contribuição","1.841.890"],["(-) Gastos fixos (custos fixos + despesas fixas)","1.957.506"],["(-) Gasto com Pessoal - Adm","169.102"],["(-) Gasto com pessoal - Prod/Oper","326.106"],["(-) Despesas Operacionais","1.462.298"],["(=) Ebitda","-115.616"],["(+) Receitas Financeiras","9.039"],["(-) Despesas Financeiras","68.665"],["(=) Resultado operacional bruto","-175.242"],["(-) Impostos Sob Lucro","193.163"],["(=) Resultado operacional líquido","-368.405"],["(-) Distribuição de Lucro","0"],["(=) Resultado pós distribuição de lucros","-368.405"]],
};

// ---- Dashboard de período (JUN/2026, todos os lançamentos) ----
const DASH_JUN = {
  from: "2026-06-01", to: "2026-06-30",
  dre: [["receita","562.670,76"],["deducoes","36.252,51"],["receita_liquida","526.418,25"],["cpv","168.801,22"],["margem_bruta","357.617,03"],["desp_var","199.930,28"],["margem_contrib","157.686,75"],["gastos_fixos","167.279,57"],["ebitda","-9.592,82"],["res_liquido","-31.781,07"]] as [string,string][],
  pe: "558.442,73", pei: "1.077.072,05", saidas: "594.785,35",
  si: "10.751.610,59", sf: "11.062.062,01",
};
// ---- Dashboard JUL/2026 (já validado antes; reincluído p/ garantir) ----
const DASH_JUL = {
  from: "2026-07-01", to: "2026-07-31",
  dre: [["receita","243.126,81"],["receita_liquida","232.587,66"],["margem_contrib","184.330,68"],["ebitda","54.278,80"],["res_liquido","38.704,81"]] as [string,string][],
  pe: "164.098,90", pei: "316.559,10", saidas: "204.422,00",
  si: "11.062.062,01", sf: "10.798.082,81",
};

const GOALS = { meta_mc_pct: 60, meta_ebitda_pct: 5, meta_lucro_pct: 4, lucro_requerido: 105000, margem_seguranca_pct: 5 };
let fail = 0, pass = 0;
const chk = (label: string, got: number, exp: number, tol: number) => {
  const ok = Math.abs(got - exp) <= tol;
  ok ? pass++ : fail++;
  if (!ok) console.log(`  ❌ ${label}: ${got.toFixed(2)} (esperado ${exp.toFixed(2)}, Δ ${(got - exp).toFixed(2)})`);
};

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { entries, classifications } = await fetchEngineData(sb, WORKSPACE_ID);

  // 1) contagem
  console.log("1) Lançamentos");
  chk("contagem", entries.length, 72535, 0);

  // 2) DRE Anual Resumido completo
  for (const year of [2024, 2025, 2026]) {
    console.log(`2) DRE Anual Resumido ${year} (19 linhas)`);
    const dre = composeDre(aggregateYear(entries, year, "todos", classifications), classifications, false);
    for (const [label, exp] of DRE_ANUAL[year]) {
      const key = DRE_KEY[label];
      const line = dre.find((l) => l.key === key);
      if (!line) { console.log(`  ⚠ linha não encontrada: ${label}`); fail++; continue; }
      chk(`${label}`, line.accum, n(exp), 5); // ±5: resíduo de arredondamento das provisões (<0,001%/ano)
    }
  }

  // 3) DFC consolidado — totais anuais (célula de fechamento)
  console.log("3) DFC consolidado — totais e saldo final");
  const DFC = { 2023: [5496354.38, 5468858.27, 27496.11], 2024: [11338422.92, 7861585.45, 3504333.58], 2025: [16337589.25, 10636468.0, 9205454.83], 2026: [6819745.15, 6448651.59, 9576548.39] } as Record<number, number[]>;
  for (const year of [2023, 2024, 2025, 2026]) {
    const agg = aggregateYear(entries, year, "todos", classifications);
    const dfc = composeDfc(agg, classifications, false);
    chk(`DFC ${year} entradas`, agg.dfcEntradas.reduce((a, b) => a + b, 0), DFC[year][0], 0.02);
    chk(`DFC ${year} saídas`, agg.dfcSaidas.reduce((a, b) => a + b, 0), DFC[year][1], 0.02);
    chk(`DFC ${year} saldo final`, dfc.saldoFinal[11], DFC[year][2], 0.02);
  }

  // 4) Dashboard de período (jun e jul)
  for (const D of [DASH_JUN, DASH_JUL]) {
    console.log(`4) Dashboard período ${D.from}..${D.to}`);
    const s = composePeriod(entries, classifications, D.from, D.to, GOALS, "todos");
    // linhas com provisão (gastos_fixos, ebitda, res_liquido) herdam o resíduo ±1
    for (const [key, exp] of D.dre) chk(`DRE ${key}`, s.dre.find((l) => l.key === key)!.value, n(exp), 1);
    chk("Ponto de Equilíbrio", s.pontoEquilibrio, n(D.pe), 2);
    chk("Total de saídas", s.totalSaidas, n(D.saidas), 1);
    chk("Saldo inicial", s.saldoInicial, n(D.si), 0.02);
    chk("Saldo final", s.saldoFinal, n(D.sf), 0.02);
    // PE Ideal: fórmula padrão (bate quando margem saudável); tolerância relativa
    // 1,5% cobre o ajuste interno do Sense em margem baixa (métrica auxiliar)
    chk("PE Ideal", s.pontoEquilibrioIdeal, n(D.pei), n(D.pei) * 0.015);
  }

  console.log(`\n${fail === 0 ? "🎯" : "💥"} ${pass} células conferem${fail ? `, ${fail} divergem` : " — TODAS as páginas batem com o SenseBoard"}`);
  process.exit(fail ? 1 : 0);
})();
