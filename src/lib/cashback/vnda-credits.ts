import { createAdminClient } from "@/lib/supabase-admin";
import { decrypt } from "@/lib/encryption";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface VndaCreditsConfig {
  apiToken: string;
  baseUrl: string;
}

export interface VndaCreditOperationResult {
  ok: boolean;
  status: number;
  error?: string;
  data?: unknown;
}

export interface VndaDepositInput {
  email: string;
  amount: number;
  description: string;
  expiresAt: Date;
}

export interface VndaWithdrawalInput {
  email: string;
  amount: number;
  description: string;
}

const DEFAULT_BASE_URL = "https://api.vnda.com.br";

export async function getVndaCreditsConfigFromDb(
  workspaceId: string,
  admin?: SupabaseClient
): Promise<VndaCreditsConfig | null> {
  const client = admin ?? createAdminClient();
  const { data } = await client
    .from("vnda_connections")
    .select("api_token")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!data?.api_token) return null;
  return {
    apiToken: decrypt(data.api_token),
    baseUrl: DEFAULT_BASE_URL,
  };
}

async function vndaFetch(
  cfg: VndaCreditsConfig,
  path: string,
  init: RequestInit
): Promise<VndaCreditOperationResult> {
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Token ${cfg.apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers || {}),
      },
    });

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* noop */
    }

    if (!res.ok) {
      const message =
        (body as { error?: string; message?: string } | null)?.error ||
        (body as { message?: string } | null)?.message ||
        `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: message, data: body };
    }

    return { ok: true, status: res.status, data: body };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : "network_error",
    };
  }
}

export function depositVndaCredit(
  cfg: VndaCreditsConfig,
  input: VndaDepositInput
): Promise<VndaCreditOperationResult> {
  return vndaFetch(cfg, "/credits/deposit", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      client_identifier: "email",
      amount: Number(input.amount.toFixed(2)),
      description: input.description,
      expires_at: input.expiresAt.toISOString(),
    }),
  });
}

export function withdrawalVndaCredit(
  cfg: VndaCreditsConfig,
  input: VndaWithdrawalInput
): Promise<VndaCreditOperationResult> {
  return vndaFetch(cfg, "/credits/withdrawal", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      client_identifier: "email",
      amount: Number(input.amount.toFixed(2)),
      description: input.description,
    }),
  });
}

export function refundVndaCredit(
  cfg: VndaCreditsConfig,
  input: VndaWithdrawalInput
): Promise<VndaCreditOperationResult> {
  return vndaFetch(cfg, "/credits/refund", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      client_identifier: "email",
      amount: Number(input.amount.toFixed(2)),
      description: input.description,
    }),
  });
}

export async function getVndaBalance(
  cfg: VndaCreditsConfig,
  email: string
): Promise<{ balance: number | null; raw: unknown }> {
  const params = new URLSearchParams({ email, client_identifier: "email" });
  const result = await vndaFetch(cfg, `/credits/balance?${params}`, { method: "GET" });
  if (!result.ok) return { balance: null, raw: result.data ?? null };
  const balance =
    (result.data as { balance?: number; amount?: number } | null)?.balance ??
    (result.data as { amount?: number } | null)?.amount ??
    null;
  return { balance: typeof balance === "number" ? balance : null, raw: result.data };
}
