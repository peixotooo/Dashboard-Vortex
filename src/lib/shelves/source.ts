import { createAdminClient } from "@/lib/supabase-admin";

/**
 * Fonte de dados de uma loja no motor de prateleiras.
 * - "vnda":   loja atual (www.bulking.com.br) — catálogo/vendas VNDA, GA4 sem filtro.
 * - "medusa": loja nova (app.bulking.com.br) — catálogo/vendas Medusa, GA4 filtrado
 *             por hostname. Mesma lógica, torneiras diferentes.
 *
 * TUDO default 'vnda': a key legada e qualquer caminho antigo ficam idênticos.
 */
export type ShelfSource = "vnda" | "medusa";

export const DEFAULT_SHELF_SOURCE: ShelfSource = "vnda";

export function normalizeShelfSource(value: unknown): ShelfSource {
  return value === "medusa" ? "medusa" : DEFAULT_SHELF_SOURCE;
}

// --- Capability probe: as colunas `source` (migration-143) já existem? ---
//
// O código é tolerante à ordem de deploy: antes da migração rodar, tudo se
// comporta exatamente como hoje (sem filtro de source, inserts sem a coluna).
// Depois da migração, o filtro liga sozinho (cache por container; um "false"
// é re-testado a cada 5 min para pegar a migração sem precisar de cold start).

const RETRY_MS = 5 * 60 * 1000;

let columnsAvailable: boolean | null = null;
let lastNegativeProbe = 0;

function isMissingColumnError(error: { code?: string; message?: string }): boolean {
  if (error.code === "42703") return true;
  const msg = (error.message || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("could not find");
}

export async function shelfSourceColumnsAvailable(): Promise<boolean> {
  if (columnsAvailable === true) return true;
  if (columnsAvailable === false && Date.now() - lastNegativeProbe < RETRY_MS) {
    return false;
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("shelf_products")
      .select("source")
      .limit(1);

    if (!error) {
      columnsAvailable = true;
      return true;
    }

    if (isMissingColumnError(error)) {
      columnsAvailable = false;
      lastNegativeProbe = Date.now();
      return false;
    }

    // Erro transitório (rede/timeout): não cacheia decisão e responde 'false'
    // (comportamento legado, sempre seguro). Se chegou aqui, o estado conhecido
    // nunca foi 'true' (teria retornado no topo).
    return false;
  } catch {
    return false;
  }
}

/** Só para testes/scripts: zera o cache do probe. */
export function resetShelfSourceColumnsCache(): void {
  columnsAvailable = null;
  lastNegativeProbe = 0;
}
