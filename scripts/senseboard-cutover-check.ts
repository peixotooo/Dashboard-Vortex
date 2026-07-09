// Validação de CUTOVER — garante que o /controladoria bate com o SenseBoard em
// TODOS os anos antes do Raphael assumir a operação no Vortex.
// Gabarito capturado AO VIVO das telas do SenseBoard em 08/07/2026 ~22:45
// (mesmo instante do export final, byte-idêntico ao importado).
//   npx tsx scripts/senseboard-cutover-check.ts
import * as dotenv from "dotenv"; import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { fetchEngineData, aggregateYear, composeDre } from "../src/lib/controladoria/engine";
import { WORKSPACE_ID } from "./senseboard-lib";

// DFC (telas /dfc?ano=YYYY — valores exatos com centavos)
const DFC: Record<number, { entradas: number; saidas: number; saldoFinal: number }> = {
  2023: { entradas: 5496354.38, saidas: 5468858.27, saldoFinal: 27496.11 },
  2024: { entradas: 11338422.92, saidas: 7861585.45, saldoFinal: 3504333.58 },
  2025: { entradas: 16337589.25, saidas: 10636468.0, saldoFinal: 9205454.83 },
  2026: { entradas: 6819745.15, saidas: 6448651.59, saldoFinal: 9576548.39 },
};
// DFC 2023 spot-checks mensais
const DFC_2023_JAN = { entradas: 357244.28, saidas: 394937.52 };
const DFC_2023_DEZ = { entradas: 620294.74, saidas: 631637.91 };

// DRE Anual Resumido (telas arredondam para inteiro → tolerância ±1)
const DRE: Record<number, { receita: number; receitaLiquida: number; ebitda: number; resLiquido: number }> = {
  2023: { receita: 5214105, receitaLiquida: 4671613, ebitda: 105019, resLiquido: 83576 },
  2024: { receita: 7000171, receitaLiquida: 5697530, ebitda: -115616, resLiquido: -368405 },
  2025: { receita: 8109073, receitaLiquida: 7286351, ebitda: 245325, resLiquido: -291154 },
};
const DRE_2023_RECEITA_MESES = [399434, 227302, 413658, 408643, 418345, 421289, 418956, 523952, 415952, 362160, 742921, 461493];

let fails = 0;
function check(label: string, got: number, exp: number, tol: number) {
  const ok = Math.abs(got - exp) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? "✅" : "❌"} ${label}: ${got.toFixed(2)} (esperado ${exp.toFixed(2)})`);
}

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const { count } = await sb
    .from("fin_entries")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", WORKSPACE_ID)
    .is("deleted_at", null);
  check("Contagem de lançamentos (Sense mostra 72.535)", count ?? 0, 72535, 0);

  const { entries, classifications } = await fetchEngineData(sb, WORKSPACE_ID);

  for (const year of [2023, 2024, 2025, 2026]) {
    const agg = aggregateYear(entries, year, "todos", classifications);
    const e = agg.dfcEntradas.reduce((a, b) => a + b, 0);
    const s = agg.dfcSaidas.reduce((a, b) => a + b, 0);
    const saldoFinal = agg.saldoInicialAno + e - s;
    check(`DFC ${year} entradas`, e, DFC[year].entradas, 0.02);
    check(`DFC ${year} saídas`, s, DFC[year].saidas, 0.02);
    check(`DFC ${year} saldo final`, saldoFinal, DFC[year].saldoFinal, 0.02);
    if (year === 2023) {
      check("DFC 2023 jan entradas", agg.dfcEntradas[0], DFC_2023_JAN.entradas, 0.02);
      check("DFC 2023 jan saídas", agg.dfcSaidas[0], DFC_2023_JAN.saidas, 0.02);
      check("DFC 2023 dez entradas", agg.dfcEntradas[11], DFC_2023_DEZ.entradas, 0.02);
      check("DFC 2023 dez saídas", agg.dfcSaidas[11], DFC_2023_DEZ.saidas, 0.02);
    }
    if (DRE[year]) {
      const dre = composeDre(agg, classifications, false);
      const g = (k: string) => dre.find((l) => l.key === k)!.accum;
      check(`DRE ${year} Receita de Vendas (acum)`, g("receita"), DRE[year].receita, 1);
      check(`DRE ${year} Receita líquida (acum)`, g("receita_liquida"), DRE[year].receitaLiquida, 1);
      // Ebitda/ROL: gabarito da tela é arredondado a inteiro e as provisões de
      // 13°/férias/multa do Sense arredondam por lançamento — resíduo máximo
      // observado: R$ 3,65/ano (0,003%). Tolerância ±5.
      check(`DRE ${year} Ebitda (acum)`, g("ebitda"), DRE[year].ebitda, 5);
      check(`DRE ${year} Resultado op. líquido (acum)`, g("res_liquido"), DRE[year].resLiquido, 5);
      if (year === 2023) {
        const rec = dre.find((l) => l.key === "receita")!;
        DRE_2023_RECEITA_MESES.forEach((exp, m) => check(`DRE 2023 receita mês ${m + 1}`, rec.months[m], exp, 1));
      }
    }
  }

  console.log(fails === 0
    ? "\n🎯 CUTOVER LIBERADO — todos os anos batem com o SenseBoard."
    : `\n💥 ${fails} divergência(s) — NÃO liberar o cutover.`);
  process.exit(fails ? 1 : 0);
})();
