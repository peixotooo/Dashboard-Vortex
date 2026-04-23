import { createAdminClient } from "@/lib/supabase-admin";
import { encrypt, decrypt } from "@/lib/encryption";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface TroqueConfig {
  apiToken: string;
  baseUrl: string;
}

export interface ExchangeSummary {
  totalValue: number;
  count: number;
  raw: unknown;
}

export async function getTroqueConfig(
  workspaceId: string,
  admin?: SupabaseClient
): Promise<TroqueConfig | null> {
  const client = admin ?? createAdminClient();
  const { data } = await client
    .from("troquecommerce_config")
    .select("api_token, base_url")
    .eq("workspace_id", workspaceId)
    .single();

  if (!data?.api_token) return null;
  return {
    apiToken: decrypt(data.api_token),
    baseUrl: data.base_url || "https://www.troquecommerce.com.br",
  };
}

export async function saveTroqueConfig(
  workspaceId: string,
  apiToken: string,
  baseUrl?: string
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin.from("troquecommerce_config").upsert(
    {
      workspace_id: workspaceId,
      api_token: encrypt(apiToken),
      base_url: baseUrl || "https://www.troquecommerce.com.br",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" }
  );
  return { ok: !error, error: error?.message };
}

/**
 * Returns total exchange/return value for a given VNDA order code.
 * Returns { totalValue: 0, count: 0 } when the order has no exchange on file.
 */
export async function getExchangesForOrder(
  cfg: TroqueConfig,
  orderCode: string
): Promise<ExchangeSummary> {
  try {
    const url = `${cfg.baseUrl}/api/public/order/list?order_code=${encodeURIComponent(orderCode)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cfg.apiToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return { totalValue: 0, count: 0, raw: null };
    const json = (await res.json().catch(() => null)) as {
      data?: Array<{ total?: number; value?: number; amount?: number; status?: string }>;
    } | null;

    const items = json?.data ?? [];
    // Consider only exchanges/returns that are approved/in-progress — ignore cancelled ones.
    const active = items.filter((item) => {
      const status = (item.status || "").toLowerCase();
      return !status.includes("cancel") && !status.includes("recusad");
    });

    const totalValue = active.reduce((sum, item) => {
      const val =
        typeof item.total === "number"
          ? item.total
          : typeof item.value === "number"
          ? item.value
          : typeof item.amount === "number"
          ? item.amount
          : 0;
      return sum + val;
    }, 0);

    return { totalValue, count: active.length, raw: json };
  } catch {
    return { totalValue: 0, count: 0, raw: null };
  }
}
