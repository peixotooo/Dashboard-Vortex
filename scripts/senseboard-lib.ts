// Parsing compartilhado do export SenseBoard (usado pelo importador e pelo teste de paridade).
// Fonte: output/senseboard-export/*.csv — ver docs/senseboard-migracao-sdd.md §4.1.
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";

export const EXPORT_DIR = path.join(process.cwd(), "output", "senseboard-export");
export const WORKSPACE_ID = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04"; // Bulking

// Categorias-raiz reais (13) — nomes contêm " - ", então o parse do caminho é
// por longest-prefix contra esta lista, nunca split simples.
export const CATEGORIES = [
  "Custo dos Produtos Vendidos",
  "Deduções de Vendas",
  "Despesas Financeiras",
  "Despesas Operacionais",
  "Despesas Variáveis",
  "Distribuição de Lucro",
  "Gasto com Pessoal - Adm",
  "Gasto com pessoal - Prod/Oper",
  "Impostos Sob Lucro",
  "Imobilizado",
  "Investimentos",
  "Receita de Vendas",
  "Receitas Financeiras",
].sort((a, b) => b.length - a.length);

export interface RawEntry {
  docNumber: string;
  competence: string | null; // ISO
  due: string | null;
  partner: string;
  description: string;
  amount: number;
  paidAt: string | null;
  accountCode: string | null;
  classificationPath: string;
  observation: string;
  costCenter: string;
  tipo: string;
  createdAt: string | null;
  createdBy: string;
  updatedAt: string | null;
  updatedBy: string;
  // derivados
  flow: 1 | -1;
  kind: "normal" | "depreciation" | "transfer" | "accrual";
  needsReview: boolean;
}

// Semântica COMPROVADA por paridade contra as telas do SenseBoard (08/07/2026,
// 37/37 números exatos — ver scripts/senseboard-parity.ts):
// - DRE: data de COMPETÊNCIA; exclui transfer e needs_review; INCLUI depreciação
//   e provisões (accrual).
// - DFC: caixa (paid_at; pendente → due_date); só kind='normal'.
// - accrual = provisão contábil (pendente + sem conta + folha "Custo Mercadoria
//   Vendida", ex. "CMV - JANEIRO 26"): DRE sim, DFC nunca.

export function parseDate(br: string): string | null {
  const m = (br || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function parseAmount(br: string): number {
  const n = parseFloat((br || "0").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function splitPath(p: string): { category: string; subcategory: string | null; name: string } {
  const cat = CATEGORIES.find((c) => p === c || p.startsWith(c + " - "));
  if (!cat) return { category: p.split(" - ")[0], subcategory: null, name: p };
  const rest = p === cat ? "" : p.slice(cat.length + 3);
  if (!rest) return { category: cat, subcategory: null, name: cat };
  // sub e folha também podem conter " - "; sem cadastro não dá pra separar com
  // certeza — o consumidor deve preferir o match exato com o cadastro (path).
  const parts = rest.split(" - ");
  if (parts.length === 1) return { category: cat, subcategory: null, name: rest };
  return { category: cat, subcategory: parts[0], name: parts.slice(1).join(" - ") };
}

export function loadEntries(): RawEntry[] {
  const csv = fs.readFileSync(path.join(EXPORT_DIR, "lancamentos-completo-2026-07-08.csv"), "utf8");
  const rows: string[][] = parse(csv, { relax_column_count: true });
  const [header, ...data] = rows;
  const i = Object.fromEntries(header.map((h, idx) => [h, idx]));
  return data.map((r) => {
    const tipo = r[i["Tipo"]];
    const pathStr = r[i["Classificação"]];
    const isTransfer = pathStr.includes("Transferências Entre Contas");
    const acct = r[i["Conta bancária"]];
    const paidRaw = r[i["Data de pagamento"]];
    const isAccrual =
      !paidRaw && !acct && pathStr.endsWith("Custo Mercadoria Vendida");
    const kind: RawEntry["kind"] =
      tipo === "Depreciação" ? "depreciation"
      : isTransfer ? "transfer"
      : isAccrual ? "accrual"
      : "normal";
    let flow: 1 | -1 = tipo.startsWith("Entrada") ? 1 : -1;
    let amount = parseAmount(r[i["Movimentação"]]);
    // 4 ajustes de caixa vêm NEGATIVOS no export ("Entrada" de valor negativo);
    // normalizamos p/ valor absoluto + fluxo invertido (agregação idêntica).
    if (amount < 0) {
      amount = -amount;
      flow = (flow === 1 ? -1 : 1) as 1 | -1;
    }
    return {
      docNumber: r[i["Número do Doc."]],
      competence: parseDate(r[i["Competência"]]),
      due: parseDate(r[i["Vencimento"]]),
      partner: r[i["Parceiro"]],
      description: r[i["Descrição"]],
      amount,
      paidAt: parseDate(r[i["Data de pagamento"]]),
      accountCode: acct ? acct.split(" - Banco:")[0].trim() : null,
      classificationPath: pathStr,
      observation: r[i["Observação"]],
      costCenter: r[i["Centro de custo"]],
      tipo,
      createdAt: parseDate(r[i["Cadastro"]]),
      createdBy: r[i["Usuário cadastro"]],
      updatedAt: parseDate(r[i["Última edição"]]),
      updatedBy: r[i["Usuário última edição"]],
      flow,
      kind,
      needsReview: tipo.includes("Não Classificado"),
    };
  });
}

export interface CadastroClassification {
  name: string;
  category: string;
  subcategory: string | null;
  flowFromCadastro: 1 | -1;
  reconstructedPath: string;
}

export function loadCadastroClassifications(): CadastroClassification[] {
  const csv = fs.readFileSync(path.join(EXPORT_DIR, "classificacoes-2026-07-08.csv"), "utf8");
  const rows: string[][] = parse(csv, { relax_column_count: true });
  const [, ...data] = rows;
  return data.map((r) => {
    const [name, category, subcategory, tipo] = r;
    const sub = subcategory && subcategory !== "--" ? subcategory : null;
    return {
      name,
      category,
      subcategory: sub,
      flowFromCadastro: tipo.startsWith("Entrada") ? 1 : -1,
      reconstructedPath: [category, sub, name].filter(Boolean).join(" - "),
    };
  });
}
