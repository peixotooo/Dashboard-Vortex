import { createAdminClient } from "@/lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VndaWebhookPayload } from "@/lib/vnda-webhook";

// --- Types ---

export type CashbackStatus =
  | "AGUARDANDO_DEPOSITO"
  | "ATIVO"
  | "USADO"
  | "EXPIRADO"
  | "CANCELADO"
  | "REATIVADO";

export type CashbackStage =
  | "LEMBRETE_1"
  | "LEMBRETE_2"
  | "LEMBRETE_3"
  | "REATIVACAO"
  | "REATIVACAO_LEMBRETE";

export type CashbackChannel = "whatsapp" | "email";

export type ChannelMode = "whatsapp_only" | "email_only" | "both" | "custom";

export type CalculateOver = "net" | "subtotal" | "total";

export interface CashbackConfigRow {
  workspace_id: string;
  percentage: number;
  calculate_over: CalculateOver;
  deposit_delay_days: number;
  validity_days: number;
  reminder_1_day: number;
  reminder_2_day: number;
  reminder_3_day: number;
  reactivation_days: number;
  reactivation_reminder_day: number;
  whatsapp_min_value: number;
  email_min_value: number;
  channel_mode: ChannelMode;
  enable_whatsapp: boolean;
  enable_email: boolean;
  enable_deposit: boolean;
  enable_refund: boolean;
  enable_troquecommerce: boolean;
}

export interface CashbackTransactionRow {
  id: string;
  workspace_id: string;
  source_order_id: string;
  numero_pedido: string | null;
  email: string;
  nome_cliente: string | null;
  telefone: string | null;
  valor_pedido: number;
  valor_frete: number;
  valor_cashback: number;
  status: CashbackStatus;
  reativado: boolean;
  troca_abatida: boolean;
  valor_troca_abatida: number | null;
  confirmado_em: string;
  depositado_em: string | null;
  expira_em: string;
  estornado_em: string | null;
  usado_em: string | null;
  lembrete1_enviado_em: string | null;
  lembrete2_enviado_em: string | null;
  lembrete3_enviado_em: string | null;
  reativacao_enviado_em: string | null;
  reativacao_lembrete2: string | null;
}

// --- Constants ---

const DEFAULTS: Omit<CashbackConfigRow, "workspace_id"> = {
  percentage: 10,
  calculate_over: "net",
  deposit_delay_days: 15,
  validity_days: 30,
  reminder_1_day: 15,
  reminder_2_day: 25,
  reminder_3_day: 29,
  reactivation_days: 15,
  reactivation_reminder_day: 13,
  whatsapp_min_value: 10,
  email_min_value: 5,
  channel_mode: "both",
  enable_whatsapp: true,
  enable_email: true,
  enable_deposit: true,
  enable_refund: true,
  enable_troquecommerce: true,
};

// --- Config helpers ---

export async function getOrCreateConfig(
  workspaceId: string,
  admin?: SupabaseClient
): Promise<CashbackConfigRow> {
  const client = admin ?? createAdminClient();

  const { data: existing } = await client
    .from("cashback_config")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (existing) return existing as CashbackConfigRow;

  const row = { workspace_id: workspaceId, ...DEFAULTS };
  await client.from("cashback_config").insert(row);
  return row as CashbackConfigRow;
}

export function shouldSendChannel(
  cfg: CashbackConfigRow,
  channel: CashbackChannel,
  perTemplateEnabled: boolean
): boolean {
  if (channel === "whatsapp" && !cfg.enable_whatsapp) return false;
  if (channel === "email" && !cfg.enable_email) return false;

  switch (cfg.channel_mode) {
    case "whatsapp_only":
      return channel === "whatsapp";
    case "email_only":
      return channel === "email";
    case "both":
      return true;
    case "custom":
      return perTemplateEnabled;
  }
}

// --- Calculation ---

/**
 * Bankers-rounded (half-to-even) to 2 decimal places to avoid systematic
 * rounding bias across thousands of transactions.
 */
export function bankersRound2(value: number): number {
  const scaled = value * 100;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let rounded: number;
  if (diff > 0.5) rounded = floor + 1;
  else if (diff < 0.5) rounded = floor;
  else rounded = floor % 2 === 0 ? floor : floor + 1;
  return rounded / 100;
}

export function calculateCashbackAmount(
  cfg: CashbackConfigRow,
  order: { total: number; subtotal?: number; shipping_price?: number | null }
): number {
  const total = order.total ?? 0;
  const subtotal = order.subtotal ?? 0;
  const shipping = order.shipping_price ?? 0;

  let base = 0;
  switch (cfg.calculate_over) {
    case "total":
      base = total;
      break;
    case "subtotal":
      base = subtotal || total;
      break;
    case "net":
    default:
      base = Math.max(0, total - shipping);
      break;
  }

  const raw = base * (cfg.percentage / 100);
  return Math.max(0, bankersRound2(raw));
}

// --- FSM ---

const VALID_TRANSITIONS: Record<CashbackStatus, CashbackStatus[]> = {
  AGUARDANDO_DEPOSITO: ["ATIVO", "CANCELADO"],
  ATIVO: ["USADO", "EXPIRADO", "CANCELADO"],
  USADO: [],
  EXPIRADO: ["REATIVADO"],
  CANCELADO: [],
  REATIVADO: ["USADO", "EXPIRADO", "CANCELADO"],
};

export function canTransition(from: CashbackStatus, to: CashbackStatus): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from].includes(to);
}

export async function logEvent(
  admin: SupabaseClient,
  workspaceId: string,
  cashbackId: string,
  tipo: string,
  payload?: Record<string, unknown>
) {
  await admin.from("cashback_events").insert({
    workspace_id: workspaceId,
    cashback_id: cashbackId,
    tipo,
    payload: payload ?? null,
  });
}

// --- Order handling ---

export function extractCreditUsed(payload: VndaWebhookPayload): number {
  const maybe = payload as unknown as {
    credit_used?: number;
    credits_used?: number;
    wallet_used?: number;
    extra?: { credit_used?: number };
  };
  return (
    maybe.credit_used ??
    maybe.credits_used ??
    maybe.wallet_used ??
    maybe.extra?.credit_used ??
    0
  );
}

export function isEligibleOrderStatus(status: string | undefined | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s === "confirmed" || s === "paid" || s === "approved";
}

export interface CreateCashbackResult {
  created: boolean;
  cashbackId?: string;
  reason?: string;
  status?: CashbackStatus;
}

/**
 * Creates a Cashback in AGUARDANDO_DEPOSITO from a VNDA order webhook.
 * Idempotent per (workspace_id, source_order_id).
 */
export async function createCashbackFromOrder(
  workspaceId: string,
  payload: VndaWebhookPayload,
  options?: { admin?: SupabaseClient }
): Promise<CreateCashbackResult> {
  const admin = options?.admin ?? createAdminClient();

  if (!isEligibleOrderStatus(payload.status)) {
    return { created: false, reason: `ineligible_status:${payload.status}` };
  }

  const cfg = await getOrCreateConfig(workspaceId, admin);
  const valorCashback = calculateCashbackAmount(cfg, {
    total: payload.total,
    subtotal: payload.subtotal,
    shipping_price: payload.shipping_price,
  });

  if (valorCashback <= 0) {
    return { created: false, reason: "zero_cashback" };
  }

  const confirmadoEm = payload.confirmed_at
    ? new Date(payload.confirmed_at)
    : payload.received_at
    ? new Date(payload.received_at)
    : new Date();

  // Provisional expiration = confirmed + deposit_delay + validity (re-computed on deposit)
  const expiraEmProvisional = new Date(confirmadoEm);
  expiraEmProvisional.setUTCDate(
    expiraEmProvisional.getUTCDate() + cfg.deposit_delay_days + cfg.validity_days
  );

  const phone = payload.phone
    ? `${payload.phone_area || ""}${payload.phone}`.trim()
    : payload.cellphone
    ? `${payload.cellphone_area || ""}${payload.cellphone}`.trim()
    : null;

  const nome = [payload.first_name, payload.last_name]
    .filter(Boolean)
    .join(" ")
    .trim() || null;

  const row = {
    workspace_id: workspaceId,
    source_order_id: String(payload.id),
    numero_pedido: payload.code || null,
    email: payload.email,
    nome_cliente: nome,
    telefone: phone,
    valor_pedido: payload.total,
    valor_frete: payload.shipping_price ?? 0,
    valor_cashback: valorCashback,
    status: "AGUARDANDO_DEPOSITO" as CashbackStatus,
    confirmado_em: confirmadoEm.toISOString(),
    expira_em: expiraEmProvisional.toISOString(),
  };

  const { data, error } = await admin
    .from("cashback_transactions")
    .upsert(row, { onConflict: "workspace_id, source_order_id", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();

  if (error) {
    return { created: false, reason: `db_error:${error.message}` };
  }

  // If insert was a noop (already exists), fetch existing
  let cashbackId = data?.id as string | undefined;
  if (!cashbackId) {
    const { data: existing } = await admin
      .from("cashback_transactions")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("source_order_id", String(payload.id))
      .single();
    cashbackId = existing?.id;
    if (!cashbackId) return { created: false, reason: "missing_after_upsert" };
    return { created: false, cashbackId, reason: "duplicate", status: "AGUARDANDO_DEPOSITO" };
  }

  await logEvent(admin, workspaceId, cashbackId, "CREATED", {
    source_order_id: String(payload.id),
    valor_pedido: payload.total,
    valor_cashback: valorCashback,
  });

  return { created: true, cashbackId, status: "AGUARDANDO_DEPOSITO" };
}

/**
 * Handles a follow-up order webhook where credit_used > 0 — marks the oldest
 * ATIVO/REATIVADO cashback for this email as USADO.
 */
export async function markAsUsedFromOrder(
  workspaceId: string,
  payload: VndaWebhookPayload,
  options?: { admin?: SupabaseClient }
): Promise<{ marked: boolean; cashbackId?: string; creditUsed: number }> {
  const creditUsed = extractCreditUsed(payload);
  if (creditUsed <= 0) return { marked: false, creditUsed: 0 };

  const admin = options?.admin ?? createAdminClient();
  const { data: active } = await admin
    .from("cashback_transactions")
    .select("id, status")
    .eq("workspace_id", workspaceId)
    .eq("email", payload.email)
    .in("status", ["ATIVO", "REATIVADO"])
    .order("depositado_em", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!active?.id) return { marked: false, creditUsed };

  const { error } = await admin
    .from("cashback_transactions")
    .update({
      status: "USADO",
      usado_em: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", active.id);

  if (error) return { marked: false, cashbackId: active.id, creditUsed };

  await logEvent(admin, workspaceId, active.id, "USO", {
    source_order_id: String(payload.id),
    credit_used: creditUsed,
  });

  return { marked: true, cashbackId: active.id, creditUsed };
}

/**
 * Handles order cancellation — before deposit: just mark CANCELADO.
 * After deposit: caller should issue a withdrawal via VNDA credits client
 * for the remaining amount and then call this.
 */
export async function cancelCashback(
  workspaceId: string,
  sourceOrderId: string,
  admin?: SupabaseClient
): Promise<{ cancelled: boolean; cashbackId?: string; previousStatus?: CashbackStatus }> {
  const client = admin ?? createAdminClient();
  const { data: existing } = await client
    .from("cashback_transactions")
    .select("id, status")
    .eq("workspace_id", workspaceId)
    .eq("source_order_id", sourceOrderId)
    .maybeSingle();

  if (!existing) return { cancelled: false };
  if (existing.status === "CANCELADO" || existing.status === "USADO") {
    return { cancelled: false, cashbackId: existing.id, previousStatus: existing.status as CashbackStatus };
  }

  const { error } = await client
    .from("cashback_transactions")
    .update({
      status: "CANCELADO",
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  if (error) return { cancelled: false, cashbackId: existing.id, previousStatus: existing.status as CashbackStatus };

  await logEvent(client, workspaceId, existing.id, "CANCELADO", {
    previous_status: existing.status,
    source_order_id: sourceOrderId,
  });

  return { cancelled: true, cashbackId: existing.id, previousStatus: existing.status as CashbackStatus };
}

/**
 * Reactivates an EXPIRADO cashback for another validity window.
 * Does NOT call VNDA — caller must orchestrate the deposit through vnda-credits.
 */
export async function reactivateCashback(
  workspaceId: string,
  cashbackId: string,
  cfg: CashbackConfigRow,
  admin?: SupabaseClient
): Promise<{ ok: boolean; error?: string; row?: CashbackTransactionRow }> {
  const client = admin ?? createAdminClient();
  const { data: current } = await client
    .from("cashback_transactions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", cashbackId)
    .maybeSingle();

  if (!current) return { ok: false, error: "not_found" };
  if (!canTransition(current.status as CashbackStatus, "REATIVADO")) {
    return { ok: false, error: `invalid_transition_from:${current.status}` };
  }
  if (current.reativado) {
    return { ok: false, error: "already_reactivated" };
  }

  const now = new Date();
  const newExpira = new Date(now);
  newExpira.setUTCDate(newExpira.getUTCDate() + cfg.reactivation_days);

  const { data: updated, error } = await client
    .from("cashback_transactions")
    .update({
      status: "REATIVADO",
      reativado: true,
      depositado_em: now.toISOString(),
      expira_em: newExpira.toISOString(),
      estornado_em: null,
      reativacao_enviado_em: null,
      reativacao_lembrete2: null,
      updated_at: now.toISOString(),
    })
    .eq("id", cashbackId)
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };

  await logEvent(client, workspaceId, cashbackId, "REATIVADO", {
    new_expira_em: newExpira.toISOString(),
    valor_cashback: current.valor_cashback,
  });

  return { ok: true, row: updated as CashbackTransactionRow };
}
