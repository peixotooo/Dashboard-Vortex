import { createAdminClient } from "@/lib/supabase-admin";
import { decrypt } from "@/lib/encryption";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface VndaCreditsConfig {
  apiToken: string;
  baseUrl: string;
  /** Required by VNDA to route to the correct shop (e.g. "www.bulking.com.br"). */
  shopHost: string;
  /** Issuer label that shows up on the VNDA credits ledger entry. */
  issuer: string;
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
  /** Unique idempotent identifier (goes in the `reference` field). */
  reference: string;
  validFrom?: Date;
  validUntil: Date;
  /** Event type — defaults to "cashback". */
  event?: string;
}

export interface VndaWithdrawalInput {
  email: string;
  amount: number;
  reference: string;
  event?: string;
}

const DEFAULT_BASE_URL = "https://api.vnda.com.br";
const DEFAULT_ISSUER = "BulkingClub";

export async function getVndaCreditsConfigFromDb(
  workspaceId: string,
  admin?: SupabaseClient
): Promise<VndaCreditsConfig | null> {
  const client = admin ?? createAdminClient();
  const { data } = await client
    .from("vnda_connections")
    .select("api_token, store_host")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!data?.api_token || !data?.store_host) return null;
  return {
    apiToken: decrypt(data.api_token),
    baseUrl: DEFAULT_BASE_URL,
    shopHost: data.store_host,
    issuer: DEFAULT_ISSUER,
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
        Authorization: `Bearer ${cfg.apiToken}`,
        "X-Shop-Host": cfg.shopHost,
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
      client_identifier: "email",
      event: input.event || "cashback",
      email: input.email,
      reference: input.reference,
      issuer: cfg.issuer,
      amount: Number(input.amount.toFixed(2)),
      valid_from: (input.validFrom ?? new Date()).toISOString(),
      valid_until: input.validUntil.toISOString(),
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
      client_identifier: "email",
      event: input.event || "cashback",
      email: input.email,
      reference: input.reference,
      issuer: cfg.issuer,
      amount: Number(input.amount.toFixed(2)),
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
      client_identifier: "email",
      event: input.event || "cashback",
      email: input.email,
      reference: input.reference,
      issuer: cfg.issuer,
      amount: Number(input.amount.toFixed(2)),
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

  const d = result.data as
    | {
        balance?: number;
        amount?: number;
        total?: number;
        available?: number;
        credits?: Array<{ amount?: number }>;
        data?: { balance?: number; total?: number };
      }
    | null;

  // VNDA's /credits/balance shape varies by account; try all known keys.
  let balance: number | null = null;
  if (typeof d?.balance === "number") balance = d.balance;
  else if (typeof d?.total === "number") balance = d.total;
  else if (typeof d?.available === "number") balance = d.available;
  else if (typeof d?.amount === "number") balance = d.amount;
  else if (typeof d?.data?.balance === "number") balance = d.data.balance;
  else if (typeof d?.data?.total === "number") balance = d.data.total;
  else if (Array.isArray(d?.credits)) {
    balance = d.credits.reduce((sum, c) => sum + (typeof c.amount === "number" ? c.amount : 0), 0);
  }

  return { balance, raw: result.data };
}
