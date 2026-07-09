// Smoke test do motor da controladoria contra o banco real (gabarito SenseBoard).
import * as dotenv from "dotenv"; import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import { fetchEngineData, aggregateYear, composeDre, composeDfc, composePeriod } from "../src/lib/controladoria/engine";
import { WORKSPACE_ID } from "./senseboard-lib";

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const t0 = Date.now();
  const { entries, classifications } = await fetchEngineData(sb, WORKSPACE_ID);
  console.log(`fetch: ${entries.length} lançamentos, ${classifications.length} classificações em ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const agg = aggregateYear(entries, 2026, "todos", classifications);
  const dre = composeDre(agg, classifications, false);
  const receita = dre.find((l) => l.key === "receita")!;
  const dfc = composeDfc(agg, classifications, false);

  const checks: [string, number, number][] = [
    ["DRE receita jul/2026", receita.months[6], 243126.81],
    ["DRE receita jan/2026", receita.months[0], 529534.7],
    ["DFC entradas jan/2026", agg.dfcEntradas[0], 1014539.52],
    ["DFC saídas dez/2026", agg.dfcSaidas[11], 187851.83],
    ["DFC saldo inicial do ano", agg.saldoInicialAno, 9205454.83],
    ["DFC resumido: fornecedores jan", dfc.lines.find((l) => l.key === "fornecedores")!.months[0], 323360.94],
    ["DFC resumido: adm/com jan", dfc.lines.find((l) => l.key === "adm_com")!.months[0], 385816.37],
    ["DFC resumido: receb. clientes jan", dfc.lines.find((l) => l.key === "receb_clientes")!.months[0], 1014197.49],
  ];
  const period = composePeriod(entries, classifications, "2026-07-01", "2026-07-31");
  checks.push(["Dashboard jul: receita", period.dre.find((l) => l.key === "receita")!.value, 243126.81]);
  checks.push(["Dashboard jul: saldo inicial", period.saldoInicial, 11062062.01]);

  let fail = 0;
  for (const [label, got, exp] of checks) {
    const ok = Math.abs(got - exp) <= 0.02;
    if (!ok) fail++;
    console.log(`${ok ? "✅" : "❌"} ${label}: ${got.toFixed(2)} (esperado ${exp.toFixed(2)})`);
  }
  console.log(fail ? `💥 ${fail} falha(s)` : "🎯 motor OK");
  process.exit(fail ? 1 : 0);
})();
