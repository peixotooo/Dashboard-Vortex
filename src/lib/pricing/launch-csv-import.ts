// Parser do relatório de coleções (formato BULKING):
//
// Arquivo tem duas seções separadas por linhas em branco:
//   1. "RESUMO POR COLEÇÃO" — uma linha por coleção
//   2. "DETALHAMENTO POR PRODUTO" — uma linha por SKU pai com:
//      Coleção, Data Lançamento Coleção, Idade Coleção (dias), Código PAI,
//      Nome do Produto, Categoria, Qtd SKUs, Qtd Vendida Total, Valor Total
//
// Parseamos só a seção 2 (mais granular: 1 row por SKU). Data Lançamento
// vem como DD/MM/YYYY — convertemos pra YYYY-MM-DD.

export type LaunchRow = {
  sku: string;
  collection: string;
  launch_date: string; // ISO YYYY-MM-DD
  name: string;
};

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

function ddmmyyyyToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

// Detecta a linha que começa a seção "DETALHAMENTO POR PRODUTO" e parseia
// a partir do header dessa seção. Aceita arquivos com BOM e mojibake.
export function parseLaunchReport(text: string): LaunchRow[] {
  // Remove BOM
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/);

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toUpperCase();
    if (l.includes("DETALHAMENTO POR PRODUTO")) {
      // O header CSV está na próxima linha não-vazia
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim().length > 0) {
          headerIdx = j;
          break;
        }
      }
      break;
    }
  }

  if (headerIdx === -1) {
    // Fallback: assume primeira linha já é o header da seção 2
    headerIdx = 0;
  }

  const header = parseCsvLine(lines[headerIdx]).map((h) => h.trim());
  // Procura colunas por nome flexível (ignora case e acentos)
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  const findCol = (...candidates: string[]) =>
    header.findIndex((h) => candidates.some((c) => norm(h).includes(norm(c))));

  const iColecao = findCol("colecao");
  // "Data Lançamento" pode aparecer como "Data Lançamento Coleção" na seção 2
  const iData = findCol("data lancamento", "data lançamento");
  const iCodigo = findCol("codigo pai", "código pai", "codigo");
  const iNome = findCol("nome do produto", "nome");

  if (iCodigo === -1 || iData === -1) {
    return [];
  }

  const rows: LaunchRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const sku = (cols[iCodigo] ?? "").trim();
    const dataRaw = (cols[iData] ?? "").trim();
    const colecao = iColecao >= 0 ? (cols[iColecao] ?? "").trim() : "";
    const nome = iNome >= 0 ? (cols[iNome] ?? "").trim() : "";
    if (!sku) continue;
    const iso = ddmmyyyyToIso(dataRaw);
    if (!iso) continue;
    rows.push({
      sku,
      collection: colecao,
      launch_date: iso,
      name: nome,
    });
  }
  return rows;
}
