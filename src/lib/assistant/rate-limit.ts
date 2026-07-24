// Rate limiting do assistente — proteção de custo (LLM) e abuso.
//
// Três camadas:
//  1. Por IP no limitador compartilhado do banco (com fallback local enquanto
//     a migration ainda não foi aplicada).
//  2. Por sessão (assistant_conversations.message_count): teto duro por conversa.
//  3. Cap diário por workspace (count em assistant_messages): teto de custo
//     global — mesmo um ataque distribuído para no cap.

import { createAdminClient } from "@/lib/supabase-admin";
import { consumeSecurityRateLimit } from "@/lib/security/rate-limit";

const MAX_PER_MINUTE_PER_IP = 8;

export async function checkIpRateLimit(ipHash: string): Promise<boolean> {
  const result = await consumeSecurityRateLimit({
    scope: "assistant:public:ip",
    key: ipHash,
    limit: MAX_PER_MINUTE_PER_IP,
    windowSeconds: 60,
  });
  return result.allowed;
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
