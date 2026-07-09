// Motor de relatórios do Financeiro próprio (migração SenseBoard).
// SEMÂNTICA COMPROVADA POR PARIDADE (37/37 números exatos vs. telas de 08/07/2026;
// scripts/senseboard-parity.ts):
//  - DRE: data de COMPETÊNCIA; exclui transferências e needs_review; inclui
//    depreciação e provisões (accrual).
//  - DFC: caixa — pago entra na data de pagamento, pendente no vencimento;
//    só kind='normal' (fora: transferência, depreciação, accrual).
//  - Saldo bancário = acumulado dos lançamentos (não há saldo inicial cadastral).
import type { SupabaseClient } from "@supabase/supabase-js";

export interface EngineEntry {
  competence_date: string | null;
  due_date: string | null;
  paid_at: string | null;
  amount: number;
  flow: 1 | -1;
  kind: "normal" | "depreciation" | "transfer" | "accrual";
  needs_review: boolean;
  classification_id: string;
  bank_account_id: string | null;
}

export interface EngineClassification {
  id: string;
  path: string;
  name: string;
  category: string;
  subcategory: string | null;
  flow: number;
  is_active: boolean;
}

export type StatusFilter = "todos" | "pagos" | "pendentes";

const PAGE = 1000; // cap de linhas por request do Supabase

export async function fetchEngineData(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: { accountIds?: string[] } = {}
): Promise<{ entries: EngineEntry[]; classifications: EngineClassification[] }> {
  const { data: cls, error: cErr } = await supabase
    .from("fin_classifications")
    .select("id, path, name, category, subcategory, flow, is_active")
    .eq("workspace_id", workspaceId);
  if (cErr) throw cErr;

  const entries: EngineEntry[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("fin_entries")
      .select(
        "competence_date, due_date, paid_at, amount, flow, kind, needs_review, classification_id, bank_account_id"
      )
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .range(from, from + PAGE - 1);
    if (opts.accountIds?.length) q = q.in("bank_account_id", opts.accountIds);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data || []) entries.push({ ...r, amount: Number(r.amount) } as EngineEntry);
    if (!data || data.length < PAGE) break;
  }
  return { entries, classifications: (cls || []) as EngineClassification[] };
}

// ---------------------------------------------------------------------------
// agregação mensal por classificação
// ---------------------------------------------------------------------------
function monthOf(iso: string | null, year: number): number | null {
  if (!iso || !iso.startsWith(String(year))) return null;
  return parseInt(iso.slice(5, 7), 10) - 1;
}

/** base de caixa: pago → data de pagamento; pendente → vencimento */
function cashDate(e: EngineEntry, status: StatusFilter): string | null {
  if (status === "pagos") return e.paid_at;
  if (status === "pendentes") return e.paid_at ? null : e.due_date;
  return e.paid_at || e.due_date;
}

export interface MonthlyByClassification {
  dre: Map<string, number[]>; // classification_id → 12 meses (valor com sinal do fluxo aplicado só na composição)
  dfc: Map<string, number[]>;
  dfcEntradas: number[];
  dfcSaidas: number[];
  saldoInicialAno: number; // acumulado de caixa antes de 01/01
  saldoInicialMes: number[]; // saldo no início de cada mês
}

export function aggregateYear(
  entries: EngineEntry[],
  year: number,
  status: StatusFilter = "todos"
): MonthlyByClassification {
  const dre = new Map<string, number[]>();
  const dfc = new Map<string, number[]>();
  const dfcEntradas = Array(12).fill(0);
  const dfcSaidas = Array(12).fill(0);
  let saldoInicialAno = 0;
  const add = (map: Map<string, number[]>, id: string, m: number, v: number) => {
    let arr = map.get(id);
    if (!arr) map.set(id, (arr = Array(12).fill(0)));
    arr[m] += v;
  };

  for (const e of entries) {
    // DRE
    if (e.kind !== "transfer" && !e.needs_review) {
      const m = monthOf(e.competence_date, year);
      if (m !== null) add(dre, e.classification_id, m, e.amount);
    }
    // DFC
    if (e.kind === "normal") {
      const d = cashDate(e, status);
      if (d) {
        const m = monthOf(d, year);
        if (m !== null) {
          add(dfc, e.classification_id, m, e.amount);
          if (e.flow === 1) dfcEntradas[m] += e.amount;
          else dfcSaidas[m] += e.amount;
        }
        if (d < `${year}-01-01`) saldoInicialAno += e.flow * e.amount;
      }
    }
  }

  const saldoInicialMes = Array(12).fill(0);
  let acc = saldoInicialAno;
  for (let m = 0; m < 12; m++) {
    saldoInicialMes[m] = acc;
    acc += dfcEntradas[m] - dfcSaidas[m];
  }
  return { dre, dfc, dfcEntradas, dfcSaidas, saldoInicialAno, saldoInicialMes };
}

// ---------------------------------------------------------------------------
// composição das linhas de relatório
// ---------------------------------------------------------------------------
export interface ReportLine {
  key: string;
  label: string;
  op: "+" | "-" | "=" | "";
  months: number[];
  accum: number;
  media: number;
  pct: number | null; // % da receita líquida (DRE)
  emphasis?: boolean; // linha de subtotal
  children?: ReportLine[];
}

function line(key: string, label: string, op: ReportLine["op"], months: number[], emphasis = false, children?: ReportLine[]): ReportLine {
  const accum = months.reduce((a, b) => a + b, 0);
  const active = months.filter((v) => Math.abs(v) > 0.005).length || 1;
  return { key, label, op, months, accum, media: accum / active, pct: null, emphasis, children };
}

const zero = () => Array(12).fill(0);
const sum = (...arrs: number[][]) => {
  const out = zero();
  for (const a of arrs) for (let i = 0; i < 12; i++) out[i] += a[i];
  return out;
};
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);

function byCategory(
  agg: Map<string, number[]>,
  cls: EngineClassification[],
  categories: string[]
): { total: number[]; children: ReportLine[] } {
  const total = zero();
  const children: ReportLine[] = [];
  for (const c of cls) {
    if (!categories.includes(c.category)) continue;
    const months = agg.get(c.id);
    if (!months || months.every((v) => Math.abs(v) < 0.005)) continue;
    for (let i = 0; i < 12; i++) total[i] += months[i];
    const label = c.subcategory ? `${c.subcategory} · ${c.name}` : c.name;
    children.push(line(c.id, label, "", months));
  }
  children.sort((a, b) => Math.abs(b.accum) - Math.abs(a.accum));
  return { total, children };
}

/** Estrutura da DRE — espelho do SenseBoard (resumido; expandido = children). */
export function composeDre(
  agg: MonthlyByClassification,
  cls: EngineClassification[],
  expanded: boolean
): ReportLine[] {
  const g = (cats: string[]) => byCategory(agg.dre, cls, cats);
  const receita = g(["Receita de Vendas"]);
  const deducoes = g(["Deduções de Vendas"]);
  const cpv = g(["Custo dos Produtos Vendidos"]);
  const despVar = g(["Despesas Variáveis"]);
  const pessoalAdm = g(["Gasto com Pessoal - Adm"]);
  const pessoalOper = g(["Gasto com pessoal - Prod/Oper"]);
  const despOper = g(["Despesas Operacionais"]);
  const recFin = g(["Receitas Financeiras"]);
  const despFin = g(["Despesas Financeiras"]);
  const impostos = g(["Impostos Sob Lucro"]);
  const distrib = g(["Distribuição de Lucro"]);

  const receitaLiquida = sub(receita.total, deducoes.total);
  const margemBruta = sub(receitaLiquida, cpv.total);
  const margemContrib = sub(margemBruta, despVar.total);
  const gastosFixos = sum(pessoalAdm.total, pessoalOper.total, despOper.total);
  const ebitda = sub(margemContrib, gastosFixos);
  const finLiq = sub(recFin.total, despFin.total);
  const resBruto = sum(ebitda, finLiq);
  const resLiquido = sub(resBruto, impostos.total);
  const resFinal = sub(resLiquido, distrib.total);

  const ch = (x: { children: ReportLine[] }) => (expanded ? x.children : undefined);
  const lines: ReportLine[] = [
    line("receita", "Receita de Vendas", "+", receita.total, false, ch(receita)),
    line("deducoes", "Deduções de Vendas", "-", deducoes.total, false, ch(deducoes)),
    line("receita_liquida", "Receita líquida", "=", receitaLiquida, true),
    line("cpv", "Custo dos Produtos Vendidos", "-", cpv.total, false, ch(cpv)),
    line("margem_bruta", "Margem bruta", "=", margemBruta, true),
    line("desp_var", "Despesas Variáveis", "-", despVar.total, false, ch(despVar)),
    line("margem_contrib", "Margem de contribuição", "=", margemContrib, true),
    line("gastos_fixos", "Gastos fixos (custos + despesas fixas)", "-", gastosFixos, false),
    line("pessoal_adm", "Gasto com Pessoal - Adm", "-", pessoalAdm.total, false, ch(pessoalAdm)),
    line("pessoal_oper", "Gasto com pessoal - Prod/Oper", "-", pessoalOper.total, false, ch(pessoalOper)),
    line("desp_oper", "Despesas Operacionais", "-", despOper.total, false, ch(despOper)),
    line("ebitda", "Ebitda", "=", ebitda, true),
    line("rec_fin", "Receitas Financeiras", "+", recFin.total, false, ch(recFin)),
    line("desp_fin", "Despesas Financeiras", "-", despFin.total, false, ch(despFin)),
    line("res_bruto", "Resultado operacional bruto", "=", resBruto, true),
    line("impostos_lucro", "Impostos Sob Lucro", "-", impostos.total, false, ch(impostos)),
    line("res_liquido", "Resultado operacional líquido", "=", resLiquido, true),
    line("distribuicao", "Distribuição de Lucro", "-", distrib.total, false, ch(distrib)),
    line("res_final", "Resultado pós distribuição de lucros", "=", resFinal, true),
  ];
  const rl = receitaLiquida.reduce((a, b) => a + b, 0) || 1;
  for (const l of lines) l.pct = (l.accum / rl) * 100;
  return lines;
}

/**
 * DFC Resumido — seções por categoria (mapeamento DERIVADO DOS DADOS e conferido
 * contra a tela de jan/2026: fornecedores = CPV + Desp. Operacionais;
 * adm/comerciais = Variáveis + Deduções + Pessoal + Impostos s/ Lucro (+ Distribuição);
 * investimento = Imobilizado + Investimentos; financiamento = Despesas/Receitas Financeiras).
 */
export function composeDfc(
  agg: MonthlyByClassification,
  cls: EngineClassification[],
  expanded: boolean
): { lines: ReportLine[]; saldoInicial: number[]; saldoFinal: number[] } {
  const clsById = new Map(cls.map((c) => [c.id, c]));
  const inflow = new Map<string, number[]>();
  const outflow = new Map<string, number[]>();
  for (const [id, months] of agg.dfc) {
    const c = clsById.get(id);
    if (!c) continue;
    (c.flow === 1 ? inflow : outflow).set(id, months);
  }
  const gIn = (cats: string[]) => byCategory(inflow, cls, cats);
  const gOut = (cats: string[]) => byCategory(outflow, cls, cats);

  const recebClientes = gIn(["Receita de Vendas"]);
  const fornecedores = gOut(["Custo dos Produtos Vendidos", "Despesas Operacionais"]);
  const admCom = gOut([
    "Despesas Variáveis", "Deduções de Vendas", "Gasto com Pessoal - Adm",
    "Gasto com pessoal - Prod/Oper", "Impostos Sob Lucro", "Distribuição de Lucro",
  ]);
  const compraAtivo = gOut(["Imobilizado", "Investimentos"]);
  const divVenda = gIn(["Imobilizado", "Investimentos"]);
  const pgtoFin = gOut(["Despesas Financeiras", "Receita de Vendas"]); // estornos de receita são raros; mantém coerência de totais
  const integrFin = gIn(["Despesas Financeiras", "Receitas Financeiras"]);
  const outrasSaidasFin = gOut(["Receitas Financeiras"]);

  const caixaOper = sub(recebClientes.total, sum(fornecedores.total, admCom.total));
  const caixaInvest = sub(divVenda.total, compraAtivo.total);
  const saidasFinanciamento = sum(pgtoFin.total, outrasSaidasFin.total);
  const caixaFin = sub(integrFin.total, saidasFinanciamento);

  const ch = (x: { children: ReportLine[] }) => (expanded ? x.children : undefined);
  const lines: ReportLine[] = [
    line("sec_oper", "Atividades Operacionais", "", zero(), true),
    line("receb_clientes", "Recebimento de Clientes", "+", recebClientes.total, false, ch(recebClientes)),
    line("fornecedores", "Pagamento a fornecedores", "-", fornecedores.total, false, ch(fornecedores)),
    line("adm_com", "Despesas administrativas e comerciais", "-", admCom.total, false, ch(admCom)),
    line("caixa_oper", "Caixa Obtido pelas Atividades Operacionais", "=", caixaOper, true),
    line("sec_invest", "Atividades de Investimento", "", zero(), true),
    line("compra_ativo", "Compra de Ativo", "-", compraAtivo.total, false, ch(compraAtivo)),
    line("div_venda", "Receita Dividendos e Venda de Ativos", "+", divVenda.total, false, ch(divVenda)),
    line("caixa_invest", "Caixa Obtido pelas Atividades de Investimento", "=", caixaInvest, true),
    line("sec_fin", "Atividades de Financiamento", "", zero(), true),
    line("pgto_financiamento", "Pagamento Financiamento", "-", saidasFinanciamento, false, ch(pgtoFin)),
    line("integralizacao", "Integralização de Capital / Entradas Financeiras", "+", integrFin.total, false, ch(integrFin)),
    line("caixa_fin", "Caixa Obtido pelas Atividades de Financiamento", "=", caixaFin, true),
  ];
  const saldoFinal = agg.saldoInicialMes.map((s, m) => s + agg.dfcEntradas[m] - agg.dfcSaidas[m]);
  return { lines, saldoInicial: agg.saldoInicialMes, saldoFinal };
}

// ---------------------------------------------------------------------------
// dashboard de período (livre, não só ano)
// ---------------------------------------------------------------------------
export interface PeriodSummary {
  dre: { key: string; label: string; op: string; value: number; pct: number | null }[];
  gastos: { label: string; value: number }[]; // distribuição de gastos (saídas DRE por classificação)
  dfcEntradas: number;
  dfcSaidas: number;
  saldoInicial: number;
  saldoFinal: number;
}

export function composePeriod(
  entries: EngineEntry[],
  cls: EngineClassification[],
  from: string,
  to: string
): PeriodSummary {
  const clsById = new Map(cls.map((c) => [c.id, c]));
  const dreByCls = new Map<string, number>();
  let dfcEntradas = 0, dfcSaidas = 0, saldoInicial = 0;

  for (const e of entries) {
    if (e.kind !== "transfer" && !e.needs_review && e.competence_date &&
        e.competence_date >= from && e.competence_date <= to) {
      dreByCls.set(e.classification_id, (dreByCls.get(e.classification_id) || 0) + e.amount);
    }
    if (e.kind === "normal") {
      const d = e.paid_at || e.due_date;
      if (d) {
        if (d >= from && d <= to) {
          if (e.flow === 1) dfcEntradas += e.amount;
          else dfcSaidas += e.amount;
        }
        if (d < from) saldoInicial += e.flow * e.amount;
      }
    }
  }

  const catTotal = (cats: string[]) => {
    let t = 0;
    for (const [id, v] of dreByCls) {
      const c = clsById.get(id);
      if (c && cats.includes(c.category)) t += v;
    }
    return t;
  };
  const receita = catTotal(["Receita de Vendas"]);
  const deducoes = catTotal(["Deduções de Vendas"]);
  const receitaLiquida = receita - deducoes;
  const cpv = catTotal(["Custo dos Produtos Vendidos"]);
  const margemBruta = receitaLiquida - cpv;
  const despVar = catTotal(["Despesas Variáveis"]);
  const margemContrib = margemBruta - despVar;
  const gastosFixos = catTotal(["Gasto com Pessoal - Adm", "Gasto com pessoal - Prod/Oper", "Despesas Operacionais"]);
  const ebitda = margemContrib - gastosFixos;
  const finLiq = catTotal(["Receitas Financeiras"]) - catTotal(["Despesas Financeiras"]);
  const resBruto = ebitda + finLiq;
  const impostos = catTotal(["Impostos Sob Lucro"]);
  const resLiquido = resBruto - impostos;

  const rl = receitaLiquida || 1;
  const dre = [
    { key: "receita", label: "Receita de Vendas", op: "+", value: receita },
    { key: "deducoes", label: "Deduções de Vendas", op: "-", value: deducoes },
    { key: "receita_liquida", label: "Receita líquida", op: "=", value: receitaLiquida },
    { key: "cpv", label: "Custo dos Produtos Vendidos", op: "-", value: cpv },
    { key: "margem_bruta", label: "Margem bruta", op: "=", value: margemBruta },
    { key: "desp_var", label: "Despesas Variáveis", op: "-", value: despVar },
    { key: "margem_contrib", label: "Margem de contribuição", op: "=", value: margemContrib },
    { key: "gastos_fixos", label: "Gastos fixos (custos + despesas fixas)", op: "-", value: gastosFixos },
    { key: "ebitda", label: "Ebitda", op: "=", value: ebitda },
    { key: "fin_liq", label: "Receitas / Despesas financeiras", op: "±", value: finLiq },
    { key: "res_bruto", label: "Resultado operacional bruto", op: "=", value: resBruto },
    { key: "impostos_lucro", label: "Impostos Sob Lucro", op: "-", value: impostos },
    { key: "res_liquido", label: "Resultado operacional líquido", op: "=", value: resLiquido },
  ].map((l) => ({ ...l, pct: (l.value / rl) * 100 }));

  const gastos = [...dreByCls.entries()]
    .map(([id, v]) => ({ c: clsById.get(id), v }))
    .filter((x) => x.c && x.c.flow === -1)
    .map((x) => ({ label: x.c!.name, value: x.v }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 20);

  return {
    dre, gastos, dfcEntradas, dfcSaidas,
    saldoInicial,
    saldoFinal: saldoInicial + dfcEntradas - dfcSaidas,
  };
}
