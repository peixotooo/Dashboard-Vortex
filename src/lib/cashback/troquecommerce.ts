import { createAdminClient } from "@/lib/supabase-admin";
import { encrypt, decrypt } from "@/lib/encryption";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent, type CashbackConfigRow, type CashbackTransactionRow } from "./api";
import { withdrawalVndaCredit, getVndaCreditsConfigFromDb } from "./vnda-credits";

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

// --- Webhook payload (incoming from Troquecommerce) ---
//
// Fields we rely on: id, ecommerce_number, status, price (optionally
// exchange_value + refund_value as fallback). Other fields documented for
// reference — Troquecommerce adds new ones over time (e.g.
// replaced_order_ecommerce_number, coupon_used_on_order, items[].seller).

export interface TroqueWebhookPayload {
  id: string;
  ecommerce_number: string;
  replaced_order_ecommerce_number?: string;
  status: string;
  reverse_type: string;
  client: { email?: string; name?: string };
  price: number;
  exchange_value: number;
  refund_value: number;
  discount?: number;
  order_shipping_cost?: number;
  retained_value?: number | null;
  coupon_used_on_order?: string | null;
  items?: unknown[];
  sellers?: string[] | null;
}

export function isTroqueWebhookPayload(body: unknown): body is TroqueWebhookPayload {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.ecommerce_number === "string" &&
    typeof o.status === "string"
  );
}

/**
 * Status values that should trigger cashback deduction. "Recusada"/"Cancelada"
 * are ignored — those mean the exchange was rejected and cashback stays whole.
 *
 * Uses string prefixes/substrings to tolerate gender variations
 * (e.g. "Finalizado" masc vs "Finalizada" fem), accent differences
 * ("Em Trânsito" vs "Em Transito"), and minor punctuation.
 */
const ACTIVE_STATUS_MATCHERS: Array<(s: string) => boolean> = [
  (s) => s.includes("aprovad"),          // Reversa Aprovada
  (s) => s.includes("em trânsito") || s.includes("em transito"),
  (s) => s.includes("coletad"),          // Coletado
  (s) => s.includes("recebid"),          // Produtos recebidos / Itens recebidos
  (s) => s.includes("entreg"),           // Entregue / Entrega Realizada
  (s) => s.includes("finaliz"),          // Finalizado / Finalizada / Reversa finalizada
];

export function isActiveExchangeStatus(status: string): boolean {
  const s = status.toLowerCase().trim();
  if (s.includes("recus") || s.includes("cancel")) return false;
  return ACTIVE_STATUS_MATCHERS.some((fn) => fn(s));
}

export interface DeductionResult {
  applied: boolean;
  skipped?: string;
  amountDeducted?: number;
  previousCashback?: number;
  newCashback?: number;
  vndaWithdrawalOk?: boolean;
  vndaWithdrawalError?: string;
}

/**
 * Applies an exchange deduction to a cashback row. Idempotency: the webhook
 * handler must check troquecommerce_webhook_logs for the external id BEFORE
 * calling this; this function itself only guards via `troca_abatida=true`.
 *
 * Rule: cut = percentage × exchangeValue. Cap at current cashback amount.
 *
 * If cashback is still AGUARDANDO_DEPOSITO: reduces valor_cashback directly
 * (the cron later deposits the reduced amount).
 * If already ATIVO/REATIVADO: reduces valor_cashback AND issues a withdrawal
 * in VNDA so the wallet matches.
 * If USADO/EXPIRADO/CANCELADO: logs only, no action.
 */
export async function applyExchangeDeduction(
  cashback: CashbackTransactionRow,
  cfg: CashbackConfigRow,
  exchangeValue: number,
  admin: SupabaseClient
): Promise<DeductionResult> {
  if (cashback.troca_abatida) {
    return { applied: false, skipped: "already_deducted" };
  }
  if (cashback.status === "USADO" || cashback.status === "CANCELADO") {
    return { applied: false, skipped: `cashback_${cashback.status.toLowerCase()}` };
  }

  const rawCut = exchangeValue * (Number(cfg.percentage) / 100);
  const cut = Math.min(Number(cashback.valor_cashback), Number(rawCut.toFixed(2)));
  if (cut <= 0) {
    return { applied: false, skipped: "zero_cut" };
  }

  const newAmount = Math.max(0, Number((Number(cashback.valor_cashback) - cut).toFixed(2)));
  const result: DeductionResult = {
    applied: true,
    amountDeducted: cut,
    previousCashback: Number(cashback.valor_cashback),
    newCashback: newAmount,
  };

  if (cashback.status === "ATIVO" || cashback.status === "REATIVADO") {
    if (cfg.enable_deposit) {
      const vnda = await getVndaCreditsConfigFromDb(cashback.workspace_id, admin);
      if (vnda) {
        const w = await withdrawalVndaCredit(vnda, {
          email: cashback.email,
          amount: cut,
          reference: `BULKING-TROCA-WITHDRAWAL-${cashback.id}-${Date.now()}`,
        });
        result.vndaWithdrawalOk = w.ok;
        if (!w.ok) result.vndaWithdrawalError = w.error;
      } else {
        result.vndaWithdrawalOk = false;
        result.vndaWithdrawalError = "no_vnda_config";
      }
    } else {
      result.vndaWithdrawalOk = true;
      result.vndaWithdrawalError = "deposit_flag_off_skipped_withdrawal";
    }
  }

  await admin
    .from("cashback_transactions")
    .update({
      valor_cashback: newAmount,
      troca_abatida: true,
      valor_troca_abatida: cut,
      // If reducing to zero for a not-yet-deposited cashback, cancel it
      status: newAmount <= 0 && cashback.status === "AGUARDANDO_DEPOSITO" ? "CANCELADO" : cashback.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cashback.id);

  await logEvent(admin, cashback.workspace_id, cashback.id, "TROCA_ABATIDA", {
    exchange_value: exchangeValue,
    cut,
    previous: cashback.valor_cashback,
    new: newAmount,
    vnda_withdrawal_ok: result.vndaWithdrawalOk,
    vnda_withdrawal_error: result.vndaWithdrawalError,
  });

  return result;
}
