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
import { normalizeBrazilianWhatsAppPhone } from "@/lib/phone";
import { getVndaConfig } from "@/lib/vnda-api";
import {
  normalizeBrazilianState,
  regionForState,
} from "@/lib/cart-recovery/location";

interface VndaClientResponse {
  id?: number;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  cellphone_area?: string | null;
  cellphone?: string | null;
  phone_area?: string | null;
  phone?: string | null;
  recent_address?: {
    phone_area?: string | null;
    phone?: string | null;
    first_phone_area?: string | null;
    first_phone?: string | null;
    second_phone_area?: string | null;
    second_phone?: string | null;
    state?: string | null;
  } | null;
  cpf?: string | null;
  birthdate?: string | null;
}

export interface EnrichableCart {
  id: string;
  vnda_client_id: number | null;
  customer_email: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_state?: string | null;
  customer_region?: string | null;
  enrichment_attempted_at?: string | null;
}

export interface EnrichResult {
  attempted: boolean;
  updated: boolean;
  customer_name: string | null;
  customer_phone: string | null;
  customer_state: string | null;
  customer_region: string | null;
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
    customer_state: cart.customer_state || null,
    customer_region: cart.customer_region || null,
  };

  // Já enriquecido (ou tentado) — não retentar.
  if (cart.enrichment_attempted_at) return baseResult;
  // Já temos nome, telefone e UF — não precisa enrichment.
  if (cart.customer_name && cart.customer_phone && cart.customer_state) {
    return baseResult;
  }

  let client: VndaClientResponse | null = null;
  if (cart.vnda_client_id) {
    const config = await getVndaConfig(workspaceId);
    if (!config) {
      console.warn(
        `[Cart Recovery Enrich] No VNDA config for workspace ${workspaceId}`
      );
    } else {
      client = await fetchVndaClient(
        cart.vnda_client_id,
        config.apiToken,
        config.storeHost
      );
    }
  }

  const now = new Date().toISOString();

  // Marca tentativa SEMPRE pra não retentar carts que dão 404.
  const patch: Record<string, unknown> = {
    enrichment_attempted_at: now,
  };

  let newName = cart.customer_name;
  let newPhone = cart.customer_phone;
  let newState = normalizeBrazilianState(cart.customer_state);

  if (client) {
    if (!newName) {
      const full =
        client.name?.trim() ||
        [client.first_name, client.last_name].filter(Boolean).join(" ").trim();
      if (full) {
        newName = full;
        patch.customer_name = full;
      }
    }
    if (!newPhone) {
      const raw = normalizeBrazilianWhatsAppPhone(
        firstPresent(
          joinPhone(client.phone_area, client.phone),
          joinPhone(client.cellphone_area, client.cellphone),
          joinPhone(
            client.recent_address?.phone_area,
            client.recent_address?.phone
          ),
          joinPhone(
            client.recent_address?.first_phone_area,
            client.recent_address?.first_phone
          ),
          joinPhone(
            client.recent_address?.second_phone_area,
            client.recent_address?.second_phone
          )
        )
      );
      if (raw) {
        newPhone = raw;
        patch.customer_phone = raw;
      }
    }
    if (!newState) {
      newState = normalizeBrazilianState(client.recent_address?.state);
    }
  }

  if (!newState) {
    newState = await fetchLatestCrmState(admin, workspaceId, cart.customer_email);
  }

  if (newState && newState !== cart.customer_state) {
    patch.customer_state = newState;
    patch.customer_region = regionForState(newState);
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
    updated:
      newName !== cart.customer_name ||
      newPhone !== cart.customer_phone ||
      newState !== cart.customer_state,
    customer_name: newName,
    customer_phone: newPhone,
    customer_state: newState,
    customer_region: regionForState(newState),
  };
}

function joinPhone(
  area?: string | null,
  phone?: string | null
): string | null {
  if (!phone) return null;
  return `${area || ""}${phone}`.trim();
}

function firstPresent(...values: Array<string | null | undefined>): string | null {
  return values.find((v) => !!v?.trim()) || null;
}

async function fetchLatestCrmState(
  admin: SupabaseClient,
  workspaceId: string,
  email: string
): Promise<string | null> {
  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail) return null;

  const { data } = await admin
    .from("crm_vendas")
    .select("state, data_compra")
    .eq("workspace_id", workspaceId)
    .eq("email", normalizedEmail)
    .not("state", "is", null)
    .order("data_compra", { ascending: false })
    .limit(20);

  for (const row of data || []) {
    const state = normalizeBrazilianState(row.state);
    if (state) return state;
  }
  return null;
}
