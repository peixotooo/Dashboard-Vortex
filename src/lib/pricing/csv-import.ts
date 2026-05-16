// Parser do CSV de CMV (formato BULKING):
//   Código, Produto, Categoria, Valor PL, , Corte, Tecido, Aviamentos, Estampa, Costura, TOTAL PRODUÇÃO
//
// Regra (do user):
//   1. Se TOTAL PRODUÇÃO existe → usa como cogs (já é soma dos componentes)
//   2. Senão, se Valor PL existe → usa Valor PL como cogs
//   3. Senão → null (vai cair na média de categoria em runtime)

export type CsvCogsRow = {
  sku: string;
  name: string;
  category: string;
  cogs: number | null;
  source_field: "total_producao" | "valor_pl" | "none";
};

// Parser de "R$ 30,00" → 30.0. Aceita também "30,00", "30.00", "30".
// Retorna null pra strings vazias / inválidas.
export function parseBrCurrency(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Remove "R$", espaços, milhar (ponto antes da vírgula). Troca vírgula por ponto.
  const cleaned = s
    .replace(/R\$/i, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:,|$))/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Parser CSV minimalista que respeita aspas duplas (campos podem conter
// vírgula entre aspas). Suficiente pro formato BULKING — não tenta cobrir
// edge cases extremos do RFC 4180 (escape de aspas com "" funciona).
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function parseCogsCsv(text: string): {
  rows: CsvCogsRow[];
  total: number;
  with_total: number;
  with_pl_only: number;
  empty: number;
} {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { rows: [], total: 0, with_total: 0, with_pl_only: 0, empty: 0 };
  }
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.findIndex((h) => h === name.toLowerCase());

  const iCodigo = idx("código") >= 0 ? idx("código") : idx("codigo");
  const iProduto = idx("produto");
  const iCategoria = idx("categoria");
  const iValorPL = idx("valor pl");
  const iTotal =
    idx("total produção") >= 0 ? idx("total produção") : idx("total producao");

  const rows: CsvCogsRow[] = [];
  let with_total = 0;
  let with_pl_only = 0;
  let empty = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const sku = (cols[iCodigo] ?? "").trim();
    if (!sku) continue;
    const name = (cols[iProduto] ?? "").trim();
    const category = (cols[iCategoria] ?? "").trim();
    const total = iTotal >= 0 ? parseBrCurrency(cols[iTotal]) : null;
    const pl = iValorPL >= 0 ? parseBrCurrency(cols[iValorPL]) : null;

    let cogs: number | null = null;
    let source: CsvCogsRow["source_field"] = "none";
    if (total != null && total > 0) {
      cogs = total;
      source = "total_producao";
      with_total += 1;
    } else if (pl != null && pl > 0) {
      cogs = pl;
      source = "valor_pl";
      with_pl_only += 1;
    } else {
      empty += 1;
    }

    rows.push({ sku, name, category, cogs, source_field: source });
  }

  return { rows, total: rows.length, with_total, with_pl_only, empty };
}
