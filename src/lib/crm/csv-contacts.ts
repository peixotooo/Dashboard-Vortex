// CSV parsing helpers for contact-list upload. Roda no browser, sem
// dependências externas (CSV é well-structured: RFC 4180-ish).
//
// detectColumnMapping reconhece header sob vários sinônimos pt/en —
// "nome", "name", "phone", "telefone", "whatsapp", "celular", "email",
// "e-mail", etc.

export type ContactField = "name" | "phone" | "email" | "ignore";

export interface ColumnMapping {
  // index → field. -1 não usado.
  byIndex: Record<number, ContactField>;
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  hasHeader: boolean;
}

export interface ParsedContact {
  name?: string;
  phone?: string;
  email?: string;
}

// RFC 4180 parser básico — lida com quoted fields, escaped quotes ("")
// e quebras de linha dentro de aspas. Detecta separador entre ',' e ';'.
export function parseCsv(text: string): ParsedCsv {
  if (!text.trim()) return { headers: [], rows: [], hasHeader: false };

  // Detecção de separador: olha a primeira linha não-vazia
  const firstNonEmpty = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const semis = (firstNonEmpty.match(/;/g) ?? []).length;
  const commas = (firstNonEmpty.match(/,/g) ?? []).length;
  const sep = semis > commas ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === sep) {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // Remove linhas totalmente vazias
  const filtered = rows.filter((r) => r.some((c) => c.trim().length > 0));
  if (filtered.length === 0) return { headers: [], rows: [], hasHeader: false };

  const first = filtered[0];
  const hasHeader = looksLikeHeader(first);
  if (hasHeader) {
    return { headers: first, rows: filtered.slice(1), hasHeader: true };
  }
  // Sem header — gera nomes genéricos
  const headers = first.map((_, idx) => `Coluna ${idx + 1}`);
  return { headers, rows: filtered, hasHeader: false };
}

// Heurística: se a primeira linha tem qualquer célula que combine com
// algum sinônimo de campo (name/phone/email), é header. Senão, NÃO é.
function looksLikeHeader(cells: string[]): boolean {
  for (const c of cells) {
    if (detectFieldFromHeader(c) !== "ignore") return true;
  }
  // Também é header se contém só strings curtas sem dígitos puros
  // (CSVs sem header geralmente começam com dados).
  return false;
}

const NAME_RX = /^(nome|name|cliente|customer|first[\s_-]?name|primeiro[\s_-]?nome|full[\s_-]?name)$/i;
const PHONE_RX = /^(phone|telefone|tel|whatsapp|wpp|wa|celular|cel|mobile|fone|n[uú]mero)$/i;
const EMAIL_RX = /^(e[\s_-]?mail|mail|endereco[\s_-]?de[\s_-]?email|endere[cç]o[\s_-]?de[\s_-]?email)$/i;

export function detectFieldFromHeader(header: string): ContactField {
  const normalized = header.trim().toLowerCase();
  if (NAME_RX.test(normalized)) return "name";
  if (PHONE_RX.test(normalized)) return "phone";
  if (EMAIL_RX.test(normalized)) return "email";
  return "ignore";
}

// Inferência a partir dos próprios dados — usada quando o header não é
// reconhecido (ou não há header). Olha as primeiras N linhas pra
// classificar cada coluna.
export function detectFieldFromData(
  columnIndex: number,
  rows: string[][],
  sample: number = 20
): ContactField {
  let emailHits = 0;
  let phoneHits = 0;
  let nameHits = 0;
  let nonEmpty = 0;
  const slice = rows.slice(0, sample);
  for (const r of slice) {
    const cell = r[columnIndex]?.trim() ?? "";
    if (!cell) continue;
    nonEmpty++;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cell)) {
      emailHits++;
    } else if (/^\+?[\d\s()-]{10,}$/.test(cell) && (cell.replace(/\D/g, "").length >= 10)) {
      phoneHits++;
    } else if (/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,}$/.test(cell)) {
      nameHits++;
    }
  }
  if (nonEmpty === 0) return "ignore";
  if (emailHits / nonEmpty > 0.5) return "email";
  if (phoneHits / nonEmpty > 0.5) return "phone";
  if (nameHits / nonEmpty > 0.5) return "name";
  return "ignore";
}

export function autoMapColumns(parsed: ParsedCsv): ColumnMapping {
  const byIndex: Record<number, ContactField> = {};
  const used = new Set<ContactField>();
  // 1ª passada: usa header
  for (let i = 0; i < parsed.headers.length; i++) {
    const field = detectFieldFromHeader(parsed.headers[i]);
    if (field !== "ignore" && !used.has(field)) {
      byIndex[i] = field;
      used.add(field);
    } else {
      byIndex[i] = "ignore";
    }
  }
  // 2ª passada: pra colunas ainda em "ignore", tenta inferir pelos dados
  for (let i = 0; i < parsed.headers.length; i++) {
    if (byIndex[i] !== "ignore") continue;
    const field = detectFieldFromData(i, parsed.rows);
    if (field !== "ignore" && !used.has(field)) {
      byIndex[i] = field;
      used.add(field);
    }
  }
  return { byIndex };
}

export function applyMapping(parsed: ParsedCsv, mapping: ColumnMapping): ParsedContact[] {
  const contacts: ParsedContact[] = [];
  // Identifica índices de cada campo (último ganha em caso de duplicado)
  let nameIdx = -1;
  let phoneIdx = -1;
  let emailIdx = -1;
  for (const [idxStr, field] of Object.entries(mapping.byIndex)) {
    const idx = Number(idxStr);
    if (field === "name") nameIdx = idx;
    else if (field === "phone") phoneIdx = idx;
    else if (field === "email") emailIdx = idx;
  }
  for (const row of parsed.rows) {
    const c: ParsedContact = {};
    if (nameIdx >= 0) {
      const v = row[nameIdx]?.trim();
      if (v) c.name = v;
    }
    if (phoneIdx >= 0) {
      const v = row[phoneIdx]?.trim();
      if (v) c.phone = v;
    }
    if (emailIdx >= 0) {
      const v = row[emailIdx]?.trim();
      if (v) c.email = v;
    }
    if (c.name || c.phone || c.email) contacts.push(c);
  }
  return contacts;
}
