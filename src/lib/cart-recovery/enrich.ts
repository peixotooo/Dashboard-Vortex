// Enrichment de carrinho abandonado via API VNDA.
//
// O webhook de carrinho abandonado da VNDA NÃO envia o nome do cliente,
// só email + client_id. Pra personalizar mensagens chamando pelo primeiro
// nome ("Oi João!"), buscamos o cliente via GET /api/v2/clients/{id}.
//
// Estratégia:
//   - Roda 1 vez por cart (marca enrichment_attempted_at na primeira tentativa).
//   - Best-effort: se a chamada falhar (4xx, 5xx, timeout), apenas loga e
//     segue — o dispatch continua com customer_name = null.
//   - Só atualiza campos que estavam vazios (não sobrescreve nome já vindo).

import type { SupabaseClient } from "@supabase/supabase-js";
import { getVndaConfig } from "@/lib/vnda-api";

interface VndaClientResponse {
  id?: number;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone_area?: string | null;
  phone?: string | null;
  cpf?: string | null;
  birthdate?: string | null;
}

export interface EnrichableCart {
  id: string;
  vnda_client_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  enrichment_attempted_at?: string | null;
}

export interface EnrichResult {
  attempted: boolean;
  updated: boolean;
  customer_name: string | null;
  customer_phone: string | null;
}

const FETCH_TIMEOUT_MS = 4000;

async function fetchVndaClient(
  clientId: number,
  apiToken: string,
  storeHost: string
): Promise<VndaClientResponse | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.vnda.com.br/api/v2/clients/${clientId}`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: "application/json",
          "X-Shop-Host": storeHost,
        },
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      console.warn(
        `[Cart Recovery Enrich] VNDA /clients/${clientId} → HTTP ${res.status}`
      );
      return null;
    }
    return (await res.json()) as VndaClientResponse;
  } catch (err) {
    console.warn(
      `[Cart Recovery Enrich] Fetch failed for client ${clientId}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function enrichCart(
  admin: SupabaseClient,
  workspaceId: string,
  cart: EnrichableCart
): Promise<EnrichResult> {
  const baseResult: EnrichResult = {
    attempted: false,
    updated: false,
    customer_name: cart.customer_name,
    customer_phone: cart.customer_phone,
  };

  // Já enriquecido (ou tentado) — não retentar.
  if (cart.enrichment_attempted_at) return baseResult;
  // Sem client_id não dá pra buscar.
  if (!cart.vnda_client_id) return baseResult;
  // Já temos nome e telefone — não precisa enrichment.
  if (cart.customer_name && cart.customer_phone) return baseResult;

  const config = await getVndaConfig(workspaceId);
  if (!config) {
    console.warn(
      `[Cart Recovery Enrich] No VNDA config for workspace ${workspaceId}`
    );
    return baseResult;
  }

  const now = new Date().toISOString();
  const client = await fetchVndaClient(
    cart.vnda_client_id,
    config.apiToken,
    config.storeHost
  );

  // Marca tentativa SEMPRE pra não retentar carts que dão 404.
  const patch: Record<string, unknown> = {
    enrichment_attempted_at: now,
  };

  let newName = cart.customer_name;
  let newPhone = cart.customer_phone;

  if (client) {
    if (!newName) {
      const full = [client.first_name, client.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (full) {
        newName = full;
        patch.customer_name = full;
      }
    }
    if (!newPhone && client.phone) {
      const raw = `${client.phone_area || ""}${client.phone}`.replace(
        /\D/g,
        ""
      );
      if (raw) {
        newPhone = raw;
        patch.customer_phone = raw;
      }
    }
  }

  const { error } = await admin
    .from("abandoned_carts")
    .update(patch)
    .eq("id", cart.id);

  if (error) {
    console.error(
      `[Cart Recovery Enrich] Failed to update cart ${cart.id}:`,
      error.message
    );
    return baseResult;
  }

  return {
    attempted: true,
    updated: newName !== cart.customer_name || newPhone !== cart.customer_phone,
    customer_name: newName,
    customer_phone: newPhone,
  };
}
