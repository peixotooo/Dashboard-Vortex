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

/** Mensagens de user+assistant do workspace hoje (UTC) — cap de custo diário. */
export async function getDailyMessageCount(workspaceId: string): Promise<number> {
  const admin = createAdminClient();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { count } = await admin
    .from("assistant_messages")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .in("role", ["user", "assistant"])
    .gte("created_at", startOfDay.toISOString());

  return count || 0;
}
