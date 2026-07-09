import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// Filtros da lista de lançamentos — compartilhados entre a rota
// de linhas (GET /lancamentos) e a de totais (GET /lancamentos/totals),
// para os KPIs baterem SEMPRE com o que a tabela mostra.
// ============================================================

export const FILTER_KEYS = [
  "q", "classification_id", "account_id", "partner_id", "status",
  "due_from", "due_to", "paid_from", "paid_to", "quick",
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyEntryFilters<T>(query: T, workspaceId: string, p: URLSearchParams): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = query;
  q = q.eq("workspace_id", workspaceId).is("deleted_at", null);
  const text = p.get("q");
  if (text) q = q.or(`description.ilike.%${text}%,doc_number.ilike.%${text}%`);
  if (p.get("classification_id")) q = q.eq("classification_id", p.get("classification_id")!);
  if (p.get("account_id")) q = q.eq("bank_account_id", p.get("account_id")!);
  if (p.get("partner_id")) q = q.eq("partner_id", p.get("partner_id")!);
  const status = p.get("status");
  if (status === "pagos") q = q.not("paid_at", "is", null);
  if (status === "pendentes") q = q.is("paid_at", null);
  if (status === "revisao") q = q.eq("needs_review", true);
  if (p.get("due_from")) q = q.gte("due_date", p.get("due_from")!);
  if (p.get("due_to")) q = q.lte("due_date", p.get("due_to")!);
  if (p.get("paid_from")) q = q.gte("paid_at", p.get("paid_from")!);
  if (p.get("paid_to")) q = q.lte("paid_at", p.get("paid_to")!);
  const quick = p.get("quick");
  if (quick) {
    const today = new Date().toISOString().slice(0, 10);
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    if (quick === "atraso") q = q.is("paid_at", null).lt("due_date", today);
    if (quick === "hoje") q = q.is("paid_at", null).eq("due_date", today);
    if (quick === "semana") q = q.is("paid_at", null).gte("due_date", today).lte("due_date", in7);
    if (quick === "receber") q = q.is("paid_at", null).eq("flow", 1);
    if (quick === "pagar") q = q.is("paid_at", null).eq("flow", -1);
  }
  return q as T;
}

export type EntryTotals = { entradas: number; saidas: number; saldo: number; count: number };

// cache curto por workspace+filtros — o conjunto sem filtro tem ~72k linhas e
// leva ~3s frio; com cache as trocas de página/aba são instantâneas
const totalsCache = new Map<string, { at: number; totals: EntryTotals }>();
const TOTALS_TTL_MS = 60_000;

export function invalidateEntryTotalsCache(workspaceId: string) {
  for (const key of totalsCache.keys()) {
    if (key.startsWith(workspaceId + "|")) totalsCache.delete(key);
  }
}

function cacheKey(workspaceId: string, p: URLSearchParams): string {
  const parts = FILTER_KEYS.map((k) => `${k}=${p.get(k) ?? ""}`);
  return workspaceId + "|" + parts.join("&");
}

/**
 * Soma entradas/saídas/saldo de TODO o conjunto filtrado (não só a página),
 * paginando em paralelo com select enxuto (amount, flow).
 */
export async function computeEntryTotals(
  supabase: SupabaseClient,
  workspaceId: string,
  p: URLSearchParams
): Promise<EntryTotals> {
  const key = cacheKey(workspaceId, p);
  const hit = totalsCache.get(key);
  if (hit && Date.now() - hit.at < TOTALS_TTL_MS) return hit.totals;

  const { count, error: cErr } = await applyEntryFilters(
    supabase.from("fin_entries").select("id", { count: "exact", head: true }),
    workspaceId,
    p
  );
  if (cErr) throw cErr;

  const PAGE = 1000; // teto do range() no Supabase
  const CONCURRENCY = 12;
  const pages = Math.ceil((count ?? 0) / PAGE);
  let entradas = 0;
  let saidas = 0;
  for (let wave = 0; wave < pages; wave += CONCURRENCY) {
    const batch = Array.from({ length: Math.min(CONCURRENCY, pages - wave) }, (_, i) =>
      applyEntryFilters(supabase.from("fin_entries").select("amount, flow"), workspaceId, p)
        .order("id")
        .range((wave + i) * PAGE, (wave + i) * PAGE + PAGE - 1)
    );
    const results = await Promise.all(batch);
    for (const { data, error } of results) {
      if (error) throw error;
      for (const r of (data ?? []) as { amount: number; flow: number }[]) {
        if (r.flow === 1) entradas += Number(r.amount);
        else saidas += Number(r.amount);
      }
    }
  }

  const totals: EntryTotals = { entradas, saidas, saldo: entradas - saidas, count: count ?? 0 };
  totalsCache.set(key, { at: Date.now(), totals });
  return totals;
}
