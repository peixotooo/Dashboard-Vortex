// Rate limiting do assistente — proteção de custo (LLM) e abuso.
//
// Três camadas:
//  1. Por IP (in-memory, por instância — mesmo padrão do checkout-events):
//     freia rajadas/bots. Serverless tem N instâncias, então é best-effort;
//     por isso existem as camadas 2 e 3 no banco.
//  2. Por sessão (assistant_conversations.message_count): teto duro por conversa.
//  3. Cap diário por workspace (count em assistant_messages): teto de custo
//     global — mesmo um ataque distribuído para no cap.

import { createAdminClient } from "@/lib/supabase-admin";

const WINDOW_MS = 60_000;
const MAX_PER_MINUTE_PER_IP = 8;
const MAX_BUCKETS = 10_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function checkIpRateLimit(ipHash: string): boolean {
  const now = Date.now();

  if (buckets.size > MAX_BUCKETS) {
    for (const [k, b] of buckets) {
      if (b.resetAt < now) buckets.delete(k);
    }
  }

  const bucket = buckets.get(ipHash);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(ipHash, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (bucket.count >= MAX_PER_MINUTE_PER_IP) return false;
  bucket.count += 1;
  return true;
}

/**
 * Mensagens de user+assistant do workspace hoje (UTC) — cap de custo diário.
 *
 * `surface` separa o orçamento: o chat global (v2) NÃO pode consumir a cota do
 * widget de PDP (v1) e vice-versa. Cada superfície tem seu próprio teto, então
 * uma rajada no /chat não derruba o assistente das páginas de produto.
 *
 * Resiliente à migration-132: se a coluna `surface` ainda não existir, a query
 * filtrada falha e a gente cai na contagem sem filtro (comportamento pré-v2).
 */
export async function getDailyMessageCount(
  workspaceId: string,
  surface?: "pdp" | "global",
  includeTests = true
): Promise<number> {
  const admin = createAdminClient();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  if (surface) {
    let query = admin
      .from("assistant_messages")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("surface", surface)
      .in("role", ["user", "assistant"])
      .gte("created_at", startOfDay.toISOString());
    if (!includeTests) query = query.eq("is_test", false);
    const { count, error } = await query;
    if (!error) return count || 0;
    // coluna ausente (migration pendente) → cai no fallback sem filtro
  }

  let query = admin
    .from("assistant_messages")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .in("role", ["user", "assistant"])
    .gte("created_at", startOfDay.toISOString());
  if (!includeTests) query = query.eq("is_test", false);
  const { count } = await query;

  return count || 0;
}
