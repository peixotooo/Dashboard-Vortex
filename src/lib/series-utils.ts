// Helpers de série temporal diária, compartilhados pelas views que medem
// crescimento ao longo do tempo (Instagram, grupos de WhatsApp, ...).
//
// Convenção: datas no formato 'YYYY-MM-DD' (bucket diário). Os pontos da série
// vêm ordenados de forma crescente por data.

export interface DeltaValue {
  value: number;
  pct: number | null;
}

/** Data 'YYYY-MM-DD' no fuso de São Paulo (alinha o bucket ao dia BR). */
export function spDateString(date: Date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) /
      86400000
  );
}

export function shiftDays(date: string, delta: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' -> 'DD/MM' para o eixo dos gráficos. */
export function toLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${d}/${m}`;
}

export function makeDelta(
  current: number,
  ref: number | null | undefined
): DeltaValue | null {
  if (ref == null) return null;
  const value = current - ref;
  const pct = ref > 0 ? Math.round((value / ref) * 10000) / 100 : null;
  return { value, pct };
}

/** Retorna a variação apenas quando os dois pontos representam dias consecutivos. */
export function dailyDeltaBetween(
  currentDate: string,
  currentValue: number,
  previousDate?: string | null,
  previousValue?: number | null
): number | null {
  if (previousDate == null || previousValue == null) return null;
  if (daysBetween(previousDate, currentDate) !== 1) return null;
  return currentValue - previousValue;
}

/**
 * Acha o ponto de referência ~N dias atrás. Pega o ponto cuja data mais se
 * aproxima de (alvo = atual - N), desde que dentro da tolerância — senão
 * retorna null pra não mostrar delta enganoso quando falta histórico.
 *
 * `series` deve estar ordenada de forma crescente por `.date`.
 */
export function refByDaysAgo<T extends { date: string }>(
  series: T[],
  n: number
): T | null {
  if (series.length < 2) return null;
  const current = series[series.length - 1];
  const target = shiftDays(current.date, -n);
  const tol = n <= 1 ? 1 : n <= 7 ? 2 : 5;

  let best: T | null = null;
  let bestDist = Infinity;
  for (const p of series) {
    if (p.date === current.date) continue;
    const dist = Math.abs(daysBetween(p.date, target));
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  if (!best || bestDist > tol) return null;
  return best;
}
