export const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** valor de relatório (sem centavos, como o SenseBoard mostra nas visões anuais) */
export function fmtReport(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 0.005) return "0";
  return Math.round(v).toLocaleString("pt-BR");
}

export function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function fmtDateBR(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function firstDayOfMonth(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`;
}

export function lastDayOfMonth(): string {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth() + 1, 0).toISOString().slice(0, 10);
}
