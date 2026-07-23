// Motor de relatórios do Financeiro próprio (migração SenseBoard).
// SEMÂNTICA COMPROVADA POR PARIDADE (37/37 números exatos vs. telas de 08/07/2026;
// scripts/senseboard-parity.ts):
//  - DRE: data de COMPETÊNCIA; exclui transferências e needs_review; inclui
//    depreciação e provisões (accrual).
//  - DFC: caixa — pago entra na data de pagamento, pendente no vencimento;
//    só kind='normal' (fora: transferência, depreciação, accrual).
//  - Saldo bancário = acumulado dos lançamentos (não há saldo inicial cadastral).
import type { SupabaseClient } from "@supabase/supabase-js";
import { invalidateEntryTotalsCache } from "./entry-filters";

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

// Subcategorias OFICIAIS da árvore SenseBoard (cadastro exportado + grupos
// vistos no DRE/DFC Expandido). O importador fatia caminhos por heurística e
// às vezes promove pedaço do NOME a "subcategoria" (ex.: "13° Salário - Adm");
// aqui normalizamos: subcategoria fora desta lista volta a fazer parte do nome.
const KNOWN_SUBCATS = new Set([
  "Aluguel", "Benefícios - Adm", "Benefícios - Prod/Oper", "Comissões de vendas",
  "Contabilidade, Jurídico, Consultoria", "Custos Variáveis de Operação",
  "Despesas bancárias", "Distribuição de lucro", "Estrutural (energia, água, seguro)",
  "Financiamentos - Entrada", "Financiamentos - Saída", "Fretes e Combustíveis (venda)",
  "Gastos com Veículos", "Impostos (Federais, Estaduais, Municipais)", "Insumos",
  "Investimentos - Saída", "Investimentos - Entrada", "Matéria prima / item revenda",
  "Mão de obra terceirizada", "Outras Despesas Operacionais", "Outras receitas financeiras",
  "Propaganda e publicidade", "Receita Venda/Revenda", "TI (software, internet, telefone)",
]);

export function normalizeClassifications(cls: EngineClassification[]): EngineClassification[] {
  return cls.map((c) =>
    c.subcategory && !KNOWN_SUBCATS.has(c.subcategory)
      ? { ...c, name: `${c.subcategory} - ${c.name}`, subcategory: null }
      : c
  );
}

// ---------------------------------------------------------------------------
// Regras descobertas na paridade multi-ano (DRE Expandido 2023 conferido
// classificação a classificação contra a tela do SenseBoard):
//
// 1. Subcategorias SÓ-CAIXA: alimentam o DFC mas ficam FORA da DRE (a DRE usa
//    a provisão mensal de CMV; compras reais de tecido/insumo/mão de obra e o
//    saque de marketplace não entram no resultado — evita dupla contagem).
// 2. Pessoal PROVISIONADO: a DRE troca os lançamentos reais de 13°/Férias/
//    Multa Rescisória por provisão mensal sobre o "Salário (s/ encargos)" da
//    mesma categoria: 13° = 1/12 (8,333%), Férias = 1/36 (2,778%),
//    Multa = 8/225 (3,556%). Conferido ao centavo (ex.: 89.394×3,5556%=3.178).
// ---------------------------------------------------------------------------
export const DRE_CASH_ONLY_SUBCATS = new Set([
  "Matéria prima / item revenda",
  "Insumos",
  "Mão de obra terceirizada",
  "Receita Venda/Revenda", // saques de marketplace — caixa, não receita nova
]);

export const PROVISION_RATES: { match: RegExp; rate: number }[] = [
  { match: /^13° Salário/, rate: 1 / 12 },
  { match: /^Férias/, rate: 1 / 36 },
  { match: /^Multa Rescisória/, rate: 8 / 225 },
];
export const PESSOAL_CATEGORIES = ["Gasto com Pessoal - Adm", "Gasto com pessoal - Prod/Oper"];
export const SALARIO_PREFIX = "Salário (s/ encargos)"; // base das provisões

/** Aplica as regras 1 e 2 sobre o mapa mensal DRE (classification_id → 12 meses). */
export function adjustDreMap(
  dre: Map<string, number[]>,
  cls: EngineClassification[]
): Map<string, number[]> {
  const byId = new Map(cls.map((c) => [c.id, c]));
  const out = new Map<string, number[]>();
  // Nos caminhos de 2 níveis a "subcategoria" vem como name (ex.: classificação
  // chamada "Insumos" direto sob a categoria) — o matching olha os dois campos.
  const leafKey = (c: EngineClassification) => c.subcategory ?? c.name;
  // salário por categoria de pessoal (base das provisões)
  const salarioByCat = new Map<string, number[]>();
  for (const [id, months] of dre) {
    const c = byId.get(id);
    if (c && PESSOAL_CATEGORIES.includes(c.category) && leafKey(c).startsWith("Salário (s/ encargos)")) {
      const acc = salarioByCat.get(c.category) ?? Array(12).fill(0);
      months.forEach((v, m) => (acc[m] += v));
      salarioByCat.set(c.category, acc);
    }
  }
  for (const [id, months] of dre) {
    const c = byId.get(id);
    if (!c) continue;
    if (DRE_CASH_ONLY_SUBCATS.has(c.subcategory ?? "") || DRE_CASH_ONLY_SUBCATS.has(c.name)) continue; // regra 1
    const prov = PESSOAL_CATEGORIES.includes(c.category)
      ? PROVISION_RATES.find((p) => p.match.test(leafKey(c)))
      : undefined;
    if (prov) {
      const sal = salarioByCat.get(c.category) ?? Array(12).fill(0);
      out.set(id, sal.map((v) => v * prov.rate)); // regra 2
    } else {
      out.set(id, months);
    }
  }
  // provisões existem mesmo sem lançamento real no ano (13°/férias/multa zerados):
  for (const c of cls) {
    if (out.has(c.id) || !PESSOAL_CATEGORIES.includes(c.category)) continue;
    const prov = PROVISION_RATES.find((p) => p.match.test(c.subcategory ?? c.name));
    if (!prov) continue;
    const sal = salarioByCat.get(c.category);
    if (sal) out.set(c.id, sal.map((v) => v * prov.rate));
  }
  return out;
}

const PAGE = 1000; // cap de linhas por request do Supabase
const CONCURRENCY = 10; // páginas buscadas em paralelo
const CACHE_TTL_MS = 60_000;

type EngineData = { entries: EngineEntry[]; classifications: EngineClassification[] };
const engineCache = new Map<string, { at: number; data: EngineData }>();

/** Chamar após qualquer mutação em fin_entries/fin_classifications. */
export function invalidateEngineCache(workspaceId: string) {
  for (const key of engineCache.keys()) {
    if (key.startsWith(workspaceId)) engineCache.delete(key);
  }
  invalidateEntryTotalsCache(workspaceId); // KPIs da lista de lançamentos
}

export async function fetchEngineData(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: { accountIds?: string[] } = {}
): Promise<EngineData> {
  const cacheKey = `${workspaceId}|${(opts.accountIds ?? []).join(",")}`;
  const hit = engineCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const base = () => {
    let q = supabase
      .from("fin_entries")
      .select(
        "competence_date, due_date, paid_at, amount, flow, kind, needs_review, classification_id, bank_account_id"
      )
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null);
    if (opts.accountIds?.length) q = q.in("bank_account_id", opts.accountIds);
    return q;
  };

  const [clsRes, countRes] = await Promise.all([
    supabase
      .from("fin_classifications")
      .select("id, path, name, category, subcategory, flow, is_active")
      .eq("workspace_id", workspaceId),
    supabase
      .from("fin_entries")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null),
  ]);
  if (clsRes.error) throw clsRes.error;
  const total = countRes.count ?? 0;

  const pages = Math.ceil(total / PAGE);
  const entries: EngineEntry[] = new Array(total);
  for (let batch = 0; batch < pages; batch += CONCURRENCY) {
    const jobs = [];
    for (let p = batch; p < Math.min(batch + CONCURRENCY, pages); p++) {
      jobs.push(
        base()
          .order("id", { ascending: true })
          .range(p * PAGE, p * PAGE + PAGE - 1)
          .then(({ data, error }) => {
            if (error) throw error;
            (data || []).forEach((r, i) => {
              entries[p * PAGE + i] = { ...r, amount: Number(r.amount) } as EngineEntry;
            });
          })
      );
    }
    await Promise.all(jobs);
  }

  const data: EngineData = {
    entries: entries.filter(Boolean),
    classifications: normalizeClassifications((clsRes.data || []) as EngineClassification[]),
  };
  engineCache.set(cacheKey, { at: Date.now(), data });
  return data;
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
  status: StatusFilter = "todos",
  classifications?: EngineClassification[],
  includeTransfers = false
): MonthlyByClassification {
  const dre = new Map<string, number[]>();
  const dfc = new Map<string, number[]>();
  const dfcEntradas = Array(12).fill(0);
  const dfcSaidas = Array(12).fill(0);
  let saldoInicialAno = 0;
  // fluxo natural da classificação: os 4 "ajustes de caixa" importados com o
  // fluxo invertido (valor negativo na origem) contam como valor NEGATIVO na
  // coluna natural — igual ao SenseBoard (net idêntico, colunas brutas também).
  const clsFlow = new Map((classifications ?? []).map((c) => [c.id, c.flow]));
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
    // DFC — só kind normal; transferências entram apenas quando há filtro de
    // conta (o Sense inclui a transferência DE/PARA a conta selecionada como
    // saída/entrada real dela). accrual e depreciation nunca entram no caixa.
    if (e.kind === "normal" || (includeTransfers && e.kind === "transfer")) {
      const d = cashDate(e, status);
      if (d) {
        const m = monthOf(d, year);
        if (m !== null) {
          const natural = clsFlow.get(e.classification_id) ?? e.flow;
          const signed = natural === e.flow ? e.amount : -e.amount;
          add(dfc, e.classification_id, m, signed);
          if (natural === 1) dfcEntradas[m] += signed;
          else dfcSaidas[m] += signed;
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

/**
 * Prazos médios (PMR/PMP): média ponderada por valor dos dias entre a
 * competência (data da venda/compra) e o pagamento efetivo, sobre lançamentos
 * pagos do ano. PMR = recebimentos (flow +1); PMP = pagamentos (flow -1).
 */
export function computePrazos(entries: EngineEntry[], year: number): { pmr: number; pmp: number } {
  let recDias = 0, recVal = 0, pagDias = 0, pagVal = 0;
  for (const e of entries) {
    if (e.kind !== "normal" || !e.paid_at || !e.competence_date) continue;
    if (!e.paid_at.startsWith(String(year))) continue;
    const dias = Math.max(
      0,
      Math.round((Date.parse(e.paid_at) - Date.parse(e.competence_date)) / 86400000)
    );
    if (e.flow === 1) { recDias += dias * e.amount; recVal += e.amount; }
    else { pagDias += dias * e.amount; pagVal += e.amount; }
  }
  return {
    pmr: recVal > 0 ? recDias / recVal : 0,
    pmp: pagVal > 0 ? pagDias / pagVal : 0,
  };
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

const ptBR = new Intl.Collator("pt-BR", { sensitivity: "base" });

function byCategory(
  agg: Map<string, number[]>,
  cls: EngineClassification[],
  categories: string[],
  grouped = false
): { total: number[]; children: ReportLine[] } {
  const total = zero();
  const perCls: { c: EngineClassification; months: number[] }[] = [];
  for (const c of cls) {
    if (!categories.includes(c.category)) continue;
    const months = agg.get(c.id) ?? zero();
    const hasValue = months.some((v) => Math.abs(v) >= 0.005);
    // como no SenseBoard: a árvore inteira aparece, mesmo zerada (as zeradas do
    // cadastro ativo entram com 0; históricas só quando têm movimento no ano)
    if (!hasValue && !(grouped && c.is_active)) continue;
    for (let i = 0; i < 12; i++) total[i] += months[i];
    perCls.push({ c, months });
  }
  const byAbs = (a: ReportLine, b: ReportLine) => Math.abs(b.accum) - Math.abs(a.accum);
  const byLabel = (a: ReportLine, b: ReportLine) => ptBR.compare(a.label, b.label);
  let children: ReportLine[];
  if (!grouped) {
    children = perCls.map(({ c, months }) =>
      line(c.id, c.subcategory ? `${c.subcategory} · ${c.name}` : c.name, "", months)
    );
    children.sort(byAbs);
  } else {
    // estrutura do SenseBoard: ordem alfabética; classificações direto na
    // categoria + grupos "Subtotal" por subcategoria com as classificações dentro
    const direct = perCls
      .filter((x) => !x.c.subcategory)
      .map((x) => line(x.c.id, x.c.name, "", x.months));
    const bySub = new Map<string, typeof perCls>();
    for (const x of perCls) {
      if (!x.c.subcategory) continue;
      const arr = bySub.get(x.c.subcategory) ?? [];
      arr.push(x);
      bySub.set(x.c.subcategory, arr);
    }
    const groups = [...bySub.entries()].map(([sub, items]) => {
      const t = zero();
      for (const x of items) x.months.forEach((v, i) => (t[i] += v));
      const inner = items.map((x) => line(x.c.id, x.c.name, "", x.months)).sort(byLabel);
      return line(`sub:${categories[0]}:${sub}`, `${sub} · Subtotal`, "=", t, false, inner);
    });
    children = [...direct, ...groups];
    children.sort(byLabel);
  }
  return { total, children };
}

/** Estrutura da DRE — espelho do SenseBoard (resumido; expandido = children). */
export function composeDre(
  agg: MonthlyByClassification,
  cls: EngineClassification[],
  expanded: boolean
): ReportLine[] {
  const adjusted = adjustDreMap(agg.dre, cls);
  const g = (cats: string[]) => byCategory(adjusted, cls, cats, expanded);
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
  const gIn = (cats: string[]) => byCategory(inflow, cls, cats, expanded);
  const gOut = (cats: string[]) => byCategory(outflow, cls, cats, expanded);

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
export interface PeriodGoals {
  meta_receita_mensal?: number;
  meta_mc_pct?: number;
  meta_ebitda_pct?: number;
  meta_lucro_pct?: number;
  lucro_requerido?: number;   // mensal
  margem_seguranca_pct?: number;
}

export interface PeriodSummary {
  dre: { key: string; label: string; op: string; value: number; pct: number | null }[];
  gastos: { label: string; value: number }[]; // distribuição de gastos (saídas DRE por classificação)
  dfcEntradas: number;
  dfcSaidas: number;
  totalSaidas: number;        // total de saídas do DRE (competência)
  saldoInicial: number;
  saldoFinal: number;
  pontoEquilibrio: number;    // COTA MÍNIMA = Gastos Fixos / MC%
  pontoEquilibrioIdeal: number; // COTA OBJETIVA = (GF + Lucro Req.) / (MC% - Margem Seg.)
  metaReceita: number;        // meta do termômetro de receita (mensal escalada, ou PE)
  mesesFator: number;         // nº de meses (fracionário) no período — escala metas
  diario: { date: string; entrada: number; saida: number; saldo: number }[]; // DFC por dia
}

/** Nº de meses fracionário coberto por [from,to] — soma por mês de (dias no período / dias do mês). */
function monthsSpan(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  let total = 0;
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const startDay = y === fy && m === fm ? fd : 1;
    const endDay = y === ty && m === tm ? td : daysInMonth;
    total += (endDay - startDay + 1) / daysInMonth;
    m++; if (m > 12) { m = 1; y++; }
  }
  return total || 1;
}

export function composePeriod(
  entries: EngineEntry[],
  cls: EngineClassification[],
  from: string,
  to: string,
  goals: PeriodGoals = {},
  status: StatusFilter = "todos"
): PeriodSummary {
  const clsById = new Map(cls.map((c) => [c.id, c]));
  const dreRaw = new Map<string, number[]>(); // valor do período no índice 0
  let dfcEntradas = 0, dfcSaidas = 0, saldoInicial = 0;
  const diarioMap = new Map<string, { entrada: number; saida: number }>();

  for (const e of entries) {
    // DRE respeita o status (pago/pendente) via mesma regra de caixa
    const dreStatusOk =
      status === "todos" || (status === "pagos" ? !!e.paid_at : !e.paid_at);
    if (e.kind !== "transfer" && !e.needs_review && dreStatusOk && e.competence_date &&
        e.competence_date >= from && e.competence_date <= to) {
      let arr = dreRaw.get(e.classification_id);
      if (!arr) dreRaw.set(e.classification_id, (arr = Array(12).fill(0)));
      arr[0] += e.amount;
    }
    if (e.kind === "normal") {
      const d = status === "pagos" ? e.paid_at : status === "pendentes" ? (e.paid_at ? null : e.due_date) : (e.paid_at || e.due_date);
      if (d) {
        if (d >= from && d <= to) {
          const natural = clsById.get(e.classification_id)?.flow ?? e.flow;
          const signed = natural === e.flow ? e.amount : -e.amount;
          const day = d.slice(0, 10);
          const slot = diarioMap.get(day) ?? { entrada: 0, saida: 0 };
          if (natural === 1) { dfcEntradas += signed; slot.entrada += signed; }
          else { dfcSaidas += signed; slot.saida += signed; }
          diarioMap.set(day, slot);
        }
        if (d < from) saldoInicial += e.flow * e.amount;
      }
    }
  }

  // mesmas regras da DRE anual (subcats só-caixa + provisões de pessoal)
  const dreByCls = new Map<string, number>();
  for (const [id, arr] of adjustDreMap(dreRaw, cls)) dreByCls.set(id, arr[0]);

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

  // distribuição de gastos: saídas do DRE por classificação, só > 1% do total (como no Sense)
  const totalSaidas = [...dreByCls.entries()].reduce((t, [id, v]) => {
    const c = clsById.get(id);
    return c && c.flow === -1 ? t + v : t;
  }, 0);
  const gastos = [...dreByCls.entries()]
    .map(([id, v]) => ({ c: clsById.get(id), v }))
    .filter((x) => x.c && x.c.flow === -1 && x.v > (totalSaidas || 1) * 0.01)
    .map((x) => ({ label: x.c!.name, value: x.v }))
    .sort((a, b) => b.value - a.value);

  // Ponto de Equilíbrio: MC% = margem de contribuição / receita líquida
  const mcPct = receitaLiquida > 0 ? margemContrib / receitaLiquida : 0;
  const meses = monthsSpan(from, to);
  const lucroReq = (goals.lucro_requerido ?? 0) * meses;
  const msPct = (goals.margem_seguranca_pct ?? 0) / 100;
  const pontoEquilibrio = mcPct > 0 ? gastosFixos / mcPct : 0;
  const pontoEquilibrioIdeal = mcPct - msPct > 0 ? (gastosFixos + lucroReq) / (mcPct - msPct) : 0;
  const metaReceita = goals.meta_receita_mensal ? goals.meta_receita_mensal * meses : pontoEquilibrio;

  const diario = [...diarioMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .reduce<{ date: string; entrada: number; saida: number; saldo: number }[]>((acc, [date, v]) => {
      const prev = acc.length ? acc[acc.length - 1].saldo : saldoInicial;
      acc.push({ date, entrada: v.entrada, saida: v.saida, saldo: prev + v.entrada - v.saida });
      return acc;
    }, []);

  return {
    dre, gastos, dfcEntradas, dfcSaidas, totalSaidas,
    saldoInicial,
    saldoFinal: saldoInicial + dfcEntradas - dfcSaidas,
    pontoEquilibrio, pontoEquilibrioIdeal, metaReceita, mesesFator: meses, diario,
  };
}
