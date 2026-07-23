import { NextRequest, NextResponse } from "next/server";
import { getControladoriaContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  DRE_CASH_ONLY_SUBCATS, PROVISION_RATES, PESSOAL_CATEGORIES, SALARIO_PREFIX,
} from "@/lib/controladoria/engine";

export const maxDuration = 30;

// Categorias que compõem cada linha-total da DRE — espelho de composeDre().
// Linhas derivadas (Margem bruta, Ebitda, Receita líquida…) NÃO entram: são
// resultado de +/− entre linhas, não somas de lançamentos.
const CATEGORIAS_DA_LINHA: Record<string, string[]> = {
  receita: ["Receita de Vendas"],
  deducoes: ["Deduções de Vendas"],
  cpv: ["Custo dos Produtos Vendidos"],
  desp_var: ["Despesas Variáveis"],
  pessoal_adm: ["Gasto com Pessoal - Adm"],
  pessoal_oper: ["Gasto com pessoal - Prod/Oper"],
  desp_oper: ["Despesas Operacionais"],
  rec_fin: ["Receitas Financeiras"],
  desp_fin: ["Despesas Financeiras"],
  impostos_lucro: ["Impostos Sob Lucro"],
  distribuicao: ["Distribuição de Lucro"],
  gastos_fixos: ["Gasto com Pessoal - Adm", "Gasto com pessoal - Prod/Oper", "Despesas Operacionais"],
};

type Cls = { id: string; category: string; subcategory: string | null; name: string; path: string; flow: number };

const leafKey = (c: Cls) => c.subcategory ?? c.name;
const isCashOnly = (c: Cls) => DRE_CASH_ONLY_SUBCATS.has(c.subcategory ?? "") || DRE_CASH_ONLY_SUBCATS.has(c.name);
const provRate = (c: Cls) =>
  PESSOAL_CATEGORIES.includes(c.category) ? PROVISION_RATES.find((r) => r.match.test(leafKey(c))) : undefined;

interface DrillRow {
  id: string;
  provision: boolean;
  descricao: string;
  parceiro: string | null;
  classificacao: string;
  competencia: string | null;
  vencimento: string | null;
  pago: string | null;
  valor: number;
  detalhe?: string; // p/ provisões: "salário 40.000 × 1/12"
}

// GET /api/controladoria/report/drill?key=<lineKey>&month=<0-11>&year=<>
// Lista os lançamentos que compõem a célula (linha × mês) da DRE.
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getControladoriaContext(request);
    const p = request.nextUrl.searchParams;
    const key = p.get("key") ?? "";
    const month = parseInt(p.get("month") ?? "-1", 10); // 0-11
    const year = parseInt(p.get("year") ?? "0", 10);
    if (month < 0 || month > 11 || !(year >= 2000)) {
      return NextResponse.json({ error: "parâmetros inválidos" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data: clsData } = await supabase
      .from("fin_classifications")
      .select("id, category, subcategory, name, path, flow")
      .eq("workspace_id", workspaceId);
    const cls = (clsData ?? []) as Cls[];
    const byId = new Map(cls.map((c) => [c.id, c]));

    // resolve o conjunto de classificações da linha clicada
    let alvo: Cls[];
    let leafClicado: Cls | null = null;
    if (byId.has(key)) {
      leafClicado = byId.get(key)!;
      alvo = [leafClicado];
    } else if (key.startsWith("sub:")) {
      const rest = key.slice(4);
      const i = rest.indexOf(":");
      const cat = rest.slice(0, i);
      const sub = rest.slice(i + 1);
      alvo = cls.filter((c) => c.category === cat && c.subcategory === sub);
    } else {
      const cats = CATEGORIAS_DA_LINHA[key];
      if (!cats) return NextResponse.json({ error: "linha_derivada" }, { status: 400 });
      // agregado: exclui subcategorias só-caixa (fora da DRE), como composeDre
      alvo = cls.filter((c) => cats.includes(c.category) && !isCashOnly(c));
    }
    if (!alvo.length) return NextResponse.json({ rows: [], total: 0 });

    const first = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const last = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);

    // partição: provisões (13º/Férias/Multa) têm valor calculado, não lançado
    const provisoes = alvo.filter((c) => provRate(c));
    const normais = alvo.filter((c) => !provRate(c));

    const rows: DrillRow[] = [];
    const avisos: string[] = [];

    if (normais.length) {
      const { data, error } = await supabase
        .from("fin_entries")
        .select(
          "id, description, competence_date, due_date, paid_at, amount, flow, kind, " +
            "partner:fin_partners(name), classification:fin_classifications(path, name, subcategory)"
        )
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .in("classification_id", normais.map((c) => c.id))
        .neq("kind", "transfer")
        .eq("needs_review", false)
        .gte("competence_date", first)
        .lte("competence_date", last)
        .order("amount", { ascending: false })
        .limit(1000);
      if (error) throw error;
      type EntryRow = {
        id: string; description: string | null; competence_date: string | null;
        due_date: string | null; paid_at: string | null; amount: number; flow: number; kind: string;
        partner: { name: string } | null;
        classification: { path: string; name: string; subcategory: string | null } | null;
      };
      for (const e of (data ?? []) as unknown as EntryRow[]) {
        const c = e.classification;
        const partner = e.partner;
        rows.push({
          id: e.id,
          provision: false,
          descricao: e.description ?? "—",
          parceiro: partner?.name ?? null,
          classificacao: c ? (c.subcategory ? `${c.subcategory} · ${c.name}` : c.name) : "",
          competencia: e.competence_date,
          vencimento: e.due_date,
          pago: e.paid_at,
          valor: Number(e.amount),
        });
      }
    }

    // provisões: valor = salário do mês na categoria × taxa
    for (const c of provisoes) {
      const rate = provRate(c)!.rate;
      const salIds = cls.filter((x) => x.category === c.category && leafKey(x).startsWith(SALARIO_PREFIX)).map((x) => x.id);
      let salario = 0;
      if (salIds.length) {
        const { data } = await supabase
          .from("fin_entries").select("amount")
          .eq("workspace_id", workspaceId).is("deleted_at", null)
          .in("classification_id", salIds).neq("kind", "transfer").eq("needs_review", false)
          .gte("competence_date", first).lte("competence_date", last);
        salario = (data ?? []).reduce((a, r) => a + Number(r.amount), 0);
      }
      const fracao = provRate(c)!.match.source.replace(/^\^/, "");
      rows.push({
        id: `prov:${c.id}`,
        provision: true,
        descricao: `${leafKey(c)} (provisão calculada)`,
        parceiro: null,
        classificacao: c.subcategory ? `${c.subcategory} · ${c.name}` : c.name,
        competencia: last,
        vencimento: null,
        pago: null,
        valor: Math.round(salario * rate * 100) / 100,
        detalhe: `salário ${salario.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} × ${(rate).toFixed(4)} (${fracao})`,
      });
    }

    if (provisoes.length) {
      avisos.push("Provisões (13º, Férias, Multa Rescisória) são calculadas sobre o salário do mês — não vêm de lançamentos individuais.");
    }
    if (leafClicado && isCashOnly(leafClicado)) {
      avisos.push("Esta subcategoria é de caixa (fora da DRE) — aparece no DFC, por isso a DRE mostra zero aqui.");
    }

    const total = rows.reduce((a, r) => a + r.valor, 0);
    rows.sort((a, b) => b.valor - a.valor);
    return NextResponse.json({ rows, total: Math.round(total * 100) / 100, avisos });
  } catch (err) {
    return handleAuthError(err);
  }
}
