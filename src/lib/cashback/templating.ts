export interface TemplateVars {
  nome: string;
  valor: number;
  expiraEm: Date;
  pedido: string;
  email: string;
}

export function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDateShort(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

export function formatDateLong(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

export function buildVarMap(vars: TemplateVars): Record<string, string> {
  return {
    nome: vars.nome,
    valor: formatBRL(vars.valor),
    expira_em: formatDateShort(vars.expiraEm),
    expira_em_long: formatDateLong(vars.expiraEm),
    pedido: vars.pedido,
    email: vars.email,
  };
}

/** Replaces {{var}} placeholders in arbitrary text with values from the map. */
export function renderTemplate(text: string, map: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
    return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : "";
  });
}
