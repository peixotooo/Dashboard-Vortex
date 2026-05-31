import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authRoute } from "@/lib/cashback/route-helpers";

export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;
const HARD_CAP = 120000;

type AdminClient = SupabaseClient;

interface CrmOrderRow {
  cpf: string | null;
  email: string | null;
  cliente: string | null;
  telefone: string | null;
  valor: number | string | null;
  data_compra: string | null;
  source_order_id?: string | null;
  numero_pedido: string | null;
}

interface CashbackRow {
  email: string | null;
  nome_cliente: string | null;
  telefone: string | null;
  status: string;
  valor_cashback: number | string | null;
  expira_em: string | null;
}

interface CashbackUsageRow {
  id: string;
  email: string | null;
  telefone: string | null;
  status: string;
  valor_cashback: number | string | null;
  valor_pedido: number | string | null;
  usado_em: string | null;
}

interface WaCampaignRow {
  id: string;
  name: string;
  status: string;
  total_messages: number | string | null;
  sent_count: number | string | null;
  delivered_count: number | string | null;
  read_count: number | string | null;
  failed_count: number | string | null;
  message_cost_usd: number | string | null;
  exchange_rate: number | string | null;
  created_at: string;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  segment_filter: {
    playbook_run_id?: string;
    playbook_id?: string;
    playbook_name?: string;
    contact_list_id?: string;
  } | null;
}

interface EmailDispatchRow {
  id: string;
  provider: string | null;
  status: string;
  subject: string | null;
  locaweb_list_ids: string[] | null;
  recipients_total: number | string | null;
  recipients_sent: number | string | null;
  recipients_failed: number | string | null;
  stats: Record<string, unknown> | null;
  scheduled_to: string | null;
  created_at: string;
}

interface CouponAuditRow {
  id: string;
  action: string;
  plan_id: string | null;
  active_coupon_id: string | null;
  created_at: string;
  details: {
    playbook_run_id?: string;
    playbook_id?: string;
    playbook_name?: string;
  } | null;
}

interface ActiveCouponRow {
  id: string;
  plan_id: string | null;
  status: string;
  vnda_coupon_code: string;
  attributed_revenue: number | string | null;
  attributed_units: number | string | null;
  discount_pct: number | string | null;
  expires_at: string;
  created_at: string;
}

interface Contact {
  email?: string;
  phone?: string;
  name?: string;
  variables?: Record<string, string>;
}

interface AudienceContact extends Contact {
  key: string;
}

interface CustomerAgg {
  key: string;
  name: string;
  email: string;
  phone: string;
  orders: number;
  totalSpent: number;
  firstAt: Date | null;
  lastAt: Date | null;
}

interface ContactListRow {
  id: string;
  name: string;
  description: string | null;
  contacts: Contact[] | null;
  total_count: number;
  phone_count: number;
  email_count: number;
  locaweb_list_id: string | null;
  created_at: string;
  auto_segment: {
    type?: string;
    role?: "treatment" | "holdout";
    run_id?: string;
    playbook_id?: string;
    playbook_name?: string;
    holdout_pct?: number;
    source_run_id?: string;
    source_decision?: string;
    created_at?: string;
  } | null;
}

const PLAYBOOK_LABELS: Record<string, string> = {
  "cashback-expiring-14d": "Saldo expirando",
  "active-cashback-balance": "Saldo ativo sem uso",
  "second-purchase-31-60d": "Segunda compra 31-60d",
  "one-time-61-90d-save": "Primeira compra esfriando",
  "repeat-61-180d": "Recompra de clientes recorrentes",
  "high-ltv-dormant": "Dormantes de alto LTV",
};

const PLAYBOOK_ATTRIBUTION_WINDOWS: Record<string, number> = {
  "cashback-expiring-14d": 7,
  "active-cashback-balance": 14,
  "second-purchase-31-60d": 14,
  "one-time-61-90d-save": 21,
  "repeat-61-180d": 21,
  "high-ltv-dormant": 21,
};

function playbookAttributionWindowDays(playbookId: string): number {
  return PLAYBOOK_ATTRIBUTION_WINDOWS[playbookId] ?? 14;
}

function withParams(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params);
  return `${path}?${qs.toString()}`;
}

const WHATSAPP_PLAYBOOK_CONTEXT: Record<
  string,
  { templateHint: string; messageGoal: string; guardrail: string }
> = {
  "cashback-expiring-14d": {
    templateHint: "cashback",
    messageGoal:
      "Avisar que o cliente tem cashback expirando, reforcar o valor disponivel e levar direto para usar o saldo. Nao oferecer desconto novo.",
    guardrail:
      "Use somente a lista de tratamento. O holdout nao recebe comunicacao para medir lift incremental.",
  },
  "active-cashback-balance": {
    templateHint: "cashback",
    messageGoal:
      "Lembrar o cliente do saldo ativo de cashback e sugerir recompra com produtos de maior afinidade. Nao criar cupom enquanto houver saldo.",
    guardrail:
      "Priorize consumo do cashback existente. Se precisar de desconto extra, crie um plano separado com aprovacao.",
  },
  "second-purchase-31-60d": {
    templateHint: "segunda recompra pos compra",
    messageGoal:
      "Gerar segunda compra com novidade, beneficio claro e urgencia moderada. Se houver cupom, citar apenas o cupom aprovado no playbook.",
    guardrail:
      "Nao misture com outro desconto automatico. Compare contra holdout para validar margem incremental.",
  },
  "one-time-61-90d-save": {
    templateHint: "reativacao recompra",
    messageGoal:
      "Recuperar comprador de uma compra com prova social, produtos de entrada e chamada simples para voltar ao site.",
    guardrail:
      "Comece com conteudo/oferta leve. Cupom so entra se o plano VNDA estiver criado para este mesmo run.",
  },
  "repeat-61-180d": {
    templateHint: "recorrente reposicao novidade",
    messageGoal:
      "Ativar recompra de cliente recorrente com reposicao, novidades e oferta limitada em produtos com margem saudavel.",
    guardrail:
      "Evite desconto em produto de margem apertada. Use cupom seletivo quando o playbook indicar.",
  },
  "high-ltv-dormant": {
    templateHint: "vip winback reativacao",
    messageGoal:
      "Winback de cliente alto LTV com abordagem VIP, motivo real para voltar e incentivo forte apenas se aprovado.",
    guardrail:
      "Exija revisao antes do disparo. Este publico tem valor alto e precisa de controle de frequencia.",
  },
};

function whatsappPlaybookParams({
  listId,
  campaignName,
  playbookId,
  playbookName,
  runId,
  audienceName,
  attributionWindowDays,
}: {
  listId: string;
  campaignName: string;
  playbookId: string;
  playbookName: string;
  runId: string;
  audienceName: string;
  attributionWindowDays?: number;
}): Record<string, string> {
  const context =
    WHATSAPP_PLAYBOOK_CONTEXT[playbookId] ||
    {
      templateHint: "retencao",
      messageGoal:
        "Criar comunicacao de retencao para a lista de tratamento mantendo a oferta alinhada ao playbook.",
      guardrail:
        "Nao disparar para holdout. O resultado deve ser medido por lift de receita e margem incremental.",
    };

  return {
    list: listId,
    name: campaignName,
    run: runId,
    playbook: playbookId,
    playbook_name: playbookName,
    audience: audienceName,
    template_hint: context.templateHint,
    message_goal: context.messageGoal,
    guardrail: context.guardrail,
    attribution_window_days: String(attributionWindowDays ?? playbookAttributionWindowDays(playbookId)),
  };
}

function couponGuardrailParams(playbookId: string): Record<string, string> {
  if (playbookId === "second-purchase-31-60d") {
    return {
      discount_min: "8",
      discount_max: "10",
      duration_hours: "72",
      max_active: "3",
      target: "low_cvr_high_views",
      unit: "pct",
      approval: "true",
      guardrail: "Segunda compra: usar cupom leve e medir incremental contra holdout.",
    };
  }
  if (playbookId === "repeat-61-180d") {
    return {
      discount_min: "6",
      discount_max: "10",
      duration_hours: "72",
      max_active: "5",
      target: "tier_b",
      unit: "auto",
      approval: "true",
      guardrail: "Recorrentes: priorizar novidade e limitar cupom a produtos com margem saudavel.",
    };
  }
  if (playbookId === "high-ltv-dormant") {
    return {
      discount_min: "10",
      discount_max: "15",
      duration_hours: "96",
      max_active: "3",
      target: "tier_b",
      unit: "pct",
      approval: "true",
      guardrail: "Winback alto LTV: oferta forte, limitada e sempre com aprovacao manual.",
    };
  }
  if (playbookId === "one-time-61-90d-save") {
    return {
      discount_min: "5",
      discount_max: "8",
      duration_hours: "72",
      max_active: "3",
      target: "tier_b",
      unit: "pct",
      approval: "true",
      guardrail: "Cliente esfriando: comecar por conteudo; cupom so se precisar do segundo toque.",
    };
  }
  return {
    discount_min: "0",
    discount_max: "0",
    duration_hours: "48",
    max_active: "1",
    target: "manual",
    unit: "pct",
    approval: "true",
    guardrail: "Cashback ativo: nao criar cupom novo enquanto houver saldo para consumir.",
  };
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizePhone(phone: string | null | undefined): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length >= 10) return `55${digits}`;
  return digits;
}

function normalizeEmail(email: string | null | undefined): string {
  return String(email || "").trim().toLowerCase();
}

function formatDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function cleanSourceRunId(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 64);
}

function cleanSourceDecision(value: unknown): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return ["scale", "setup", "wait", "pause", "watch"].includes(normalized) ? normalized : "";
}

function daysSince(date: Date | null, now: Date): number {
  if (!date) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - date.getTime()) / DAY_MS);
}

function customerKey(row: Pick<CrmOrderRow, "cpf" | "email" | "telefone">): string | null {
  const email = normalizeEmail(row.email);
  if (email) return `email:${email}`;
  const cpf = row.cpf?.replace(/\D/g, "");
  if (cpf) return `cpf:${cpf}`;
  const phone = normalizePhone(row.telefone);
  if (phone.length >= 10) return `phone:${phone}`;
  return null;
}

function orderKey(row: CrmOrderRow): string {
  const source = row.source_order_id?.trim();
  if (source) return `source:${source}`;
  const pedido = row.numero_pedido?.trim();
  if (pedido) return `pedido:${pedido}`;
  return [
    customerKey(row) || row.cliente || "anon",
    row.data_compra || "sem-data",
    toNumber(row.valor),
  ].join(":");
}

function hashPercent(key: string, seed: string): number {
  const hex = createHash("sha1").update(`${seed}:${key}`).digest("hex").slice(0, 8);
  return parseInt(hex, 16) % 100;
}

function listCounts(contacts: Contact[]) {
  return {
    total_count: contacts.length,
    phone_count: contacts.filter((contact) => contact.phone).length,
    email_count: contacts.filter((contact) => contact.email).length,
  };
}

async function fetchCrmOrders(admin: AdminClient, workspaceId: string): Promise<CrmOrderRow[]> {
  const rows: CrmOrderRow[] = [];

  for (let from = 0; from < HARD_CAP; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("crm_vendas")
      .select("cpf, email, cliente, telefone, valor, data_compra, source_order_id, numero_pedido")
      .eq("workspace_id", workspaceId)
      .order("data_compra", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const page = (data || []) as CrmOrderRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

async function fetchActiveCashback(admin: AdminClient, workspaceId: string): Promise<CashbackRow[]> {
  const rows: CashbackRow[] = [];
  for (let from = 0; from < 20000; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("cashback_transactions")
      .select("email, nome_cliente, telefone, status, valor_cashback, expira_em")
      .eq("workspace_id", workspaceId)
      .in("status", ["ATIVO", "REATIVADO"])
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const page = (data || []) as CashbackRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function aggregateCustomers(rows: CrmOrderRow[]): CustomerAgg[] {
  const seenOrders = new Set<string>();
  const customers = new Map<string, CustomerAgg>();

  for (const row of rows) {
    const dedupe = orderKey(row);
    if (seenOrders.has(dedupe)) continue;
    seenOrders.add(dedupe);

    const key = customerKey(row);
    if (!key) continue;

    const date = parseDate(row.data_compra);
    const existing =
      customers.get(key) ||
      ({
        key,
        name: row.cliente?.trim() || "",
        email: normalizeEmail(row.email),
        phone: normalizePhone(row.telefone),
        orders: 0,
        totalSpent: 0,
        firstAt: null,
        lastAt: null,
      } satisfies CustomerAgg);

    existing.orders += 1;
    existing.totalSpent += toNumber(row.valor);
    if (row.cliente?.trim()) existing.name = row.cliente.trim();
    if (row.email?.trim()) existing.email = normalizeEmail(row.email);
    if (row.telefone?.trim()) existing.phone = normalizePhone(row.telefone);
    if (date) {
      if (!existing.firstAt || date < existing.firstAt) existing.firstAt = date;
      if (!existing.lastAt || date > existing.lastAt) existing.lastAt = date;
    }
    customers.set(key, existing);
  }

  return [...customers.values()];
}

function customerToContact(customer: CustomerAgg, now: Date): AudienceContact {
  const avgTicket = customer.orders > 0 ? customer.totalSpent / customer.orders : 0;
  const days = daysSince(customer.lastAt, now);
  return {
    key: customer.key,
    email: customer.email || undefined,
    phone: customer.phone || undefined,
    name: customer.name || undefined,
    variables: {
      nome: customer.name || "",
      total_compras: String(customer.orders),
      valor_total: customer.totalSpent.toFixed(2),
      ticket_medio: avgTicket.toFixed(2),
      dias_ultima_compra: Number.isFinite(days) ? String(days) : "",
      ultima_compra: formatDate(customer.lastAt),
    },
  };
}

function cashbackAudience(rows: CashbackRow[], now: Date, expiringOnly: boolean): AudienceContact[] {
  const until14 = new Date(now.getTime() + 14 * DAY_MS);
  const byKey = new Map<string, AudienceContact & { value: number; expiresAt: Date | null }>();

  for (const row of rows) {
    const expiresAt = parseDate(row.expira_em);
    if (expiringOnly && (!expiresAt || expiresAt > until14)) continue;

    const email = normalizeEmail(row.email);
    const phone = normalizePhone(row.telefone);
    const key = email ? `email:${email}` : phone ? `phone:${phone}` : "";
    if (!key) continue;

    const current = byKey.get(key);
    const value = toNumber(row.valor_cashback);
    if (current) {
      current.value += value;
      if (expiresAt && (!current.expiresAt || expiresAt < current.expiresAt)) {
        current.expiresAt = expiresAt;
      }
      continue;
    }

    byKey.set(key, {
      key,
      email: email || undefined,
      phone: phone || undefined,
      name: row.nome_cliente?.trim() || undefined,
      value,
      expiresAt,
      variables: {},
    });
  }

  return [...byKey.values()].map((contact) => {
    const daysToExpire = contact.expiresAt
      ? Math.max(0, Math.ceil((contact.expiresAt.getTime() - now.getTime()) / DAY_MS))
      : "";
    return {
      key: contact.key,
      email: contact.email,
      phone: contact.phone,
      name: contact.name,
      variables: {
        nome: contact.name || "",
        saldo_cashback: contact.value.toFixed(2),
        expira_em: formatDate(contact.expiresAt),
        dias_para_expirar: String(daysToExpire),
      },
    };
  });
}

async function buildAudience(admin: AdminClient, workspaceId: string, playbookId: string) {
  const now = new Date();
  if (playbookId === "cashback-expiring-14d" || playbookId === "active-cashback-balance") {
    const rows = await fetchActiveCashback(admin, workspaceId);
    return cashbackAudience(rows, now, playbookId === "cashback-expiring-14d");
  }

  const orders = await fetchCrmOrders(admin, workspaceId);
  const customers = aggregateCustomers(orders);
  const avgCustomerLtv =
    customers.length > 0
      ? customers.reduce((sum, customer) => sum + customer.totalSpent, 0) / customers.length
      : 0;
  const highLtvThreshold = Math.max(650, avgCustomerLtv * 0.9);

  const predicate = (customer: CustomerAgg) => {
    const days = daysSince(customer.lastAt, now);
    if (playbookId === "second-purchase-31-60d") {
      return customer.orders === 1 && days >= 31 && days <= 60;
    }
    if (playbookId === "one-time-61-90d-save") {
      return customer.orders === 1 && days >= 61 && days <= 90;
    }
    if (playbookId === "repeat-61-180d") {
      return customer.orders >= 2 && days >= 61 && days <= 180;
    }
    if (playbookId === "high-ltv-dormant") {
      return customer.orders >= 2 && customer.totalSpent >= highLtvThreshold && days > 180;
    }
    return false;
  };

  return customers.filter(predicate).map((customer) => customerToContact(customer, now));
}

function publicContact(contact: AudienceContact): Contact {
  return {
    ...(contact.email ? { email: contact.email } : {}),
    ...(contact.phone ? { phone: contact.phone } : {}),
    ...(contact.name ? { name: contact.name } : {}),
    ...(contact.variables ? { variables: contact.variables } : {}),
  };
}

async function createList(params: {
  admin: AdminClient;
  workspaceId: string;
  userId: string;
  name: string;
  description: string;
  contacts: Contact[];
  autoSegment: Record<string, unknown>;
}) {
  const counts = listCounts(params.contacts);
  const { data, error } = await params.admin
    .from("crm_contact_lists")
    .insert({
      workspace_id: params.workspaceId,
      name: params.name,
      description: params.description,
      contacts: params.contacts,
      total_count: counts.total_count,
      phone_count: counts.phone_count,
      email_count: counts.email_count,
      created_by: params.userId,
      auto_segment: params.autoSegment,
    })
    .select("id, name, description, total_count, phone_count, email_count, locaweb_list_id, created_at, auto_segment")
    .single();

  if (error) throw error;
  return data as Omit<ContactListRow, "contacts">;
}

function contactKeys(contacts: Contact[] | null | undefined): Set<string> {
  const keys = new Set<string>();
  for (const contact of contacts || []) {
    const email = normalizeEmail(contact.email);
    if (email) keys.add(`email:${email}`);
    const phone = normalizePhone(contact.phone);
    if (phone) keys.add(`phone:${phone}`);
  }
  return keys;
}

function saleKeys(row: CrmOrderRow): string[] {
  const keys: string[] = [];
  const email = normalizeEmail(row.email);
  if (email) keys.push(`email:${email}`);
  const phone = normalizePhone(row.telefone);
  if (phone) keys.push(`phone:${phone}`);
  return keys;
}

function cashbackUsageKeys(row: CashbackUsageRow): string[] {
  const keys: string[] = [];
  const email = normalizeEmail(row.email);
  if (email) keys.push(`email:${email}`);
  const phone = normalizePhone(row.telefone);
  if (phone) keys.push(`phone:${phone}`);
  return keys;
}

function summarizeSalesForList(
  list: ContactListRow | undefined,
  sales: CrmOrderRow[],
  marginPct: number
) {
  if (!list) {
    return { buyers: 0, orders: 0, revenue: 0, conversionRate: 0, revenuePerContact: 0, contribution: 0 };
  }

  const keys = contactKeys(list.contacts);
  const buyers = new Set<string>();
  const orders = new Set<string>();
  let revenue = 0;

  for (const sale of sales) {
    const matchedKey = saleKeys(sale).find((key) => keys.has(key));
    if (!matchedKey) continue;
    const order = orderKey(sale);
    if (orders.has(order)) continue;
    orders.add(order);
    buyers.add(matchedKey);
    revenue += toNumber(sale.valor);
  }

  return {
    buyers: buyers.size,
    orders: orders.size,
    revenue,
    conversionRate: list.total_count > 0 ? buyers.size / list.total_count : 0,
    revenuePerContact: list.total_count > 0 ? revenue / list.total_count : 0,
    contribution: revenue * (marginPct / 100),
  };
}

function summarizeCashbackForList(
  list: ContactListRow | undefined,
  usages: CashbackUsageRow[]
) {
  if (!list) {
    return { users: 0, uses: 0, cashbackValue: 0, orderValue: 0, usageRate: 0, valuePerContact: 0 };
  }

  const keys = contactKeys(list.contacts);
  const users = new Set<string>();
  const seen = new Set<string>();
  let cashbackValue = 0;
  let orderValue = 0;

  for (const usage of usages) {
    const matchedKey = cashbackUsageKeys(usage).find((key) => keys.has(key));
    if (!matchedKey || seen.has(usage.id)) continue;
    seen.add(usage.id);
    users.add(matchedKey);
    cashbackValue += toNumber(usage.valor_cashback);
    orderValue += toNumber(usage.valor_pedido);
  }

  return {
    users: users.size,
    uses: seen.size,
    cashbackValue,
    orderValue,
    usageRate: list.total_count > 0 ? users.size / list.total_count : 0,
    valuePerContact: list.total_count > 0 ? cashbackValue / list.total_count : 0,
  };
}

async function fetchSalesSince(
  admin: AdminClient,
  workspaceId: string,
  since: string
): Promise<CrmOrderRow[]> {
  const rows: CrmOrderRow[] = [];
  for (let from = 0; from < 50000; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("crm_vendas")
      .select("cpf, email, cliente, telefone, valor, data_compra, source_order_id, numero_pedido")
      .eq("workspace_id", workspaceId)
      .gte("data_compra", since)
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const page = (data || []) as CrmOrderRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchCashbackUsagesSince(
  admin: AdminClient,
  workspaceId: string,
  since: string
): Promise<CashbackUsageRow[]> {
  const rows: CashbackUsageRow[] = [];
  for (let from = 0; from < 50000; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("cashback_transactions")
      .select("id, email, telefone, status, valor_cashback, valor_pedido, usado_em")
      .eq("workspace_id", workspaceId)
      .not("usado_em", "is", null)
      .gte("usado_em", since)
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const page = (data || []) as CashbackUsageRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchWaCampaignsSince(
  admin: AdminClient,
  workspaceId: string,
  since: string,
  runIds: Set<string>
): Promise<WaCampaignRow[]> {
  const rows: WaCampaignRow[] = [];
  for (let from = 0; from < 10000; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("wa_campaigns")
      .select(
        "id, name, status, total_messages, sent_count, delivered_count, read_count, failed_count, message_cost_usd, exchange_rate, created_at, scheduled_at, started_at, completed_at, segment_filter"
      )
      .eq("workspace_id", workspaceId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const page = ((data || []) as WaCampaignRow[]).filter((campaign) => {
      const runId = campaign.segment_filter?.playbook_run_id;
      return runId ? runIds.has(runId) : false;
    });
    rows.push(...page);
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function summarizeWaCampaigns(runId: string, campaigns: WaCampaignRow[]) {
  const rows = campaigns.filter((campaign) => campaign.segment_filter?.playbook_run_id === runId);
  const totals = rows.reduce(
    (acc, campaign) => {
      const sent = toNumber(campaign.sent_count);
      const total = toNumber(campaign.total_messages);
      const delivered = toNumber(campaign.delivered_count);
      const read = toNumber(campaign.read_count);
      const failed = toNumber(campaign.failed_count);
      const costBrl = sent * toNumber(campaign.message_cost_usd, 0.0625) * toNumber(campaign.exchange_rate, 5.5);
      acc.totalMessages += total;
      acc.sent += sent;
      acc.delivered += delivered;
      acc.read += read;
      acc.failed += failed;
      acc.costBrl += costBrl;
      acc.statuses[campaign.status] = (acc.statuses[campaign.status] || 0) + 1;
      return acc;
    },
    {
      totalMessages: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      costBrl: 0,
      statuses: {} as Record<string, number>,
    }
  );

  return {
    campaignCount: rows.length,
    ...totals,
    campaigns: rows.slice(0, 5).map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      totalMessages: toNumber(campaign.total_messages),
      sent: toNumber(campaign.sent_count),
      costBrl:
        toNumber(campaign.sent_count) *
        toNumber(campaign.message_cost_usd, 0.0625) *
        toNumber(campaign.exchange_rate, 5.5),
      createdAt: campaign.created_at,
    })),
  };
}

function summarizeEmailChannel(list: ContactListRow) {
  const listId = list.locaweb_list_id;
  return {
    listReady: Boolean(listId),
    locawebListId: listId,
    emailContacts: list.email_count,
    sourceListId: list.id,
  };
}

async function fetchEmailDispatchesSince(
  admin: AdminClient,
  workspaceId: string,
  since: string,
  locawebListIds: Set<string>
): Promise<EmailDispatchRow[]> {
  if (locawebListIds.size === 0) return [];

  const rows: EmailDispatchRow[] = [];
  for (let from = 0; from < 10000; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("email_template_dispatches")
      .select(
        "id, provider, status, subject, locaweb_list_ids, recipients_total, recipients_sent, recipients_failed, stats, scheduled_to, created_at"
      )
      .eq("workspace_id", workspaceId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const page = ((data || []) as EmailDispatchRow[]).filter((dispatch) =>
      (dispatch.locaweb_list_ids || []).some((listId) => locawebListIds.has(String(listId)))
    );
    rows.push(...page);
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function summarizeEmailDispatches(
  list: ContactListRow,
  dispatches: EmailDispatchRow[],
  runId: string,
  attribution: { start: Date | null; end: Date | null }
) {
  const base = summarizeEmailChannel(list);
  if (!list.locaweb_list_id) {
    return {
      ...base,
      dispatchCount: 0,
      sent: 0,
      failed: 0,
      opens: 0,
      clicks: 0,
      statuses: {} as Record<string, number>,
      dispatches: [] as Array<{
        id: string;
        subject: string | null;
        status: string;
        provider: string;
        sent: number;
        failed: number;
        createdAt: string;
      }>,
    };
  }

  const rows = dispatches.filter((dispatch) => {
    const statsRunValue = dispatch.stats?.playbook_run_id;
    const statsRunId = typeof statsRunValue === "string" ? statsRunValue : "";
    if (statsRunId) return statsRunId === runId;

    const createdAt = parseDate(dispatch.created_at);
    const withinAttribution =
      createdAt &&
      attribution.start &&
      attribution.end &&
      createdAt >= attribution.start &&
      createdAt <= attribution.end;

    return (
      Boolean(withinAttribution) &&
      (dispatch.locaweb_list_ids || []).some((listId) => String(listId) === list.locaweb_list_id)
    );
  });
  const totals = rows.reduce(
    (acc, dispatch) => {
      const sent = toNumber(dispatch.recipients_sent);
      const total = toNumber(dispatch.recipients_total);
      const failed = toNumber(dispatch.recipients_failed);
      const stats = dispatch.stats || {};
      acc.sent += sent || total;
      acc.failed += failed;
      acc.opens += toNumber(stats.opens ?? stats.opened ?? stats.total_opens);
      acc.clicks += toNumber(stats.clicks ?? stats.clicked ?? stats.total_clicks);
      acc.statuses[dispatch.status] = (acc.statuses[dispatch.status] || 0) + 1;
      return acc;
    },
    {
      sent: 0,
      failed: 0,
      opens: 0,
      clicks: 0,
      statuses: {} as Record<string, number>,
    }
  );

  return {
    ...base,
    dispatchCount: rows.length,
    ...totals,
    dispatches: rows.slice(0, 5).map((dispatch) => ({
      id: dispatch.id,
      subject: dispatch.subject,
      status: dispatch.status,
      provider: dispatch.provider || "locaweb",
      sent: toNumber(dispatch.recipients_sent) || toNumber(dispatch.recipients_total),
      failed: toNumber(dispatch.recipients_failed),
      createdAt: dispatch.created_at,
    })),
  };
}

async function fetchCouponAuditsSince(
  admin: AdminClient,
  workspaceId: string,
  since: string,
  runIds: Set<string>
): Promise<CouponAuditRow[]> {
  const rows: CouponAuditRow[] = [];
  for (let from = 0; from < 10000; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("coupon_audit_log")
      .select("id, action, plan_id, active_coupon_id, created_at, details")
      .eq("workspace_id", workspaceId)
      .in("action", ["plan_created", "cron_picked"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const page = ((data || []) as CouponAuditRow[]).filter((audit) => {
      const runId = audit.details?.playbook_run_id;
      return runId ? runIds.has(runId) : false;
    });
    rows.push(...page);
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchActiveCouponsForPlans(
  admin: AdminClient,
  workspaceId: string,
  planIds: Set<string>
): Promise<ActiveCouponRow[]> {
  if (planIds.size === 0) return [];

  const ids = [...planIds];
  const rows: ActiveCouponRow[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    const slice = ids.slice(start, start + 100);
    const { data, error } = await admin
      .from("promo_active_coupons")
      .select(
        "id, plan_id, status, vnda_coupon_code, attributed_revenue, attributed_units, discount_pct, expires_at, created_at"
      )
      .eq("workspace_id", workspaceId)
      .in("plan_id", slice)
      .order("created_at", { ascending: false });

    if (error) throw error;
    rows.push(...((data || []) as ActiveCouponRow[]));
  }
  return rows;
}

function summarizeCoupons(
  runId: string,
  audits: CouponAuditRow[],
  coupons: ActiveCouponRow[]
) {
  const planIds = new Set(
    audits
      .filter((audit) => audit.details?.playbook_run_id === runId && audit.plan_id)
      .map((audit) => audit.plan_id as string)
  );
  const directCouponIds = new Set(
    audits
      .filter((audit) => audit.details?.playbook_run_id === runId && audit.active_coupon_id)
      .map((audit) => audit.active_coupon_id as string)
  );
  const rows =
    directCouponIds.size > 0
      ? coupons.filter((coupon) => directCouponIds.has(coupon.id))
      : coupons.filter((coupon) => coupon.plan_id && planIds.has(coupon.plan_id));
  const couponDiscountAmount = (coupon: ActiveCouponRow) => {
    const attributedRevenue = toNumber(coupon.attributed_revenue);
    const discountPct = Math.min(95, Math.max(0, toNumber(coupon.discount_pct)));
    const discountRate = discountPct / 100;
    return discountRate > 0
      ? attributedRevenue * (discountRate / Math.max(0.01, 1 - discountRate))
      : 0;
  };
  const totals = rows.reduce(
    (acc, coupon) => {
      const attributedRevenue = toNumber(coupon.attributed_revenue);

      acc.attributedRevenue += attributedRevenue;
      acc.attributedUnits += toNumber(coupon.attributed_units);
      acc.attributedDiscount += couponDiscountAmount(coupon);
      acc.statuses[coupon.status] = (acc.statuses[coupon.status] || 0) + 1;
      return acc;
    },
    {
      attributedRevenue: 0,
      attributedUnits: 0,
      attributedDiscount: 0,
      statuses: {} as Record<string, number>,
    }
  );

  return {
    planCount: planIds.size,
    couponCount: rows.length,
    ...totals,
    coupons: rows.slice(0, 5).map((coupon) => ({
      id: coupon.id,
      code: coupon.vnda_coupon_code,
      status: coupon.status,
      discountPct: toNumber(coupon.discount_pct),
      attributedRevenue: toNumber(coupon.attributed_revenue),
      attributedUnits: toNumber(coupon.attributed_units),
      attributedDiscount: couponDiscountAmount(coupon),
      expiresAt: coupon.expires_at,
    })),
  };
}

function summarizeCashbackUsage(
  treatment: ContactListRow,
  holdout: ContactListRow | undefined,
  usages: CashbackUsageRow[]
) {
  const treatmentUsage = summarizeCashbackForList(treatment, usages);
  const holdoutUsage = summarizeCashbackForList(holdout, usages);
  const liftUsageRate = treatmentUsage.usageRate - holdoutUsage.usageRate;
  const liftValuePerContact = treatmentUsage.valuePerContact - holdoutUsage.valuePerContact;
  const treatmentOrderPerContact =
    treatment.total_count > 0 ? treatmentUsage.orderValue / treatment.total_count : 0;
  const holdoutOrderPerContact =
    holdout && holdout.total_count > 0 ? holdoutUsage.orderValue / holdout.total_count : 0;
  const incrementalCashbackValue = Math.max(0, liftValuePerContact * treatment.total_count);
  const incrementalOrderValue = Math.max(
    0,
    (treatmentOrderPerContact - holdoutOrderPerContact) * treatment.total_count
  );

  return {
    treatment: treatmentUsage,
    holdout: holdoutUsage,
    liftUsageRate,
    incrementalCashbackValue,
    incrementalOrderValue,
  };
}

async function contributionMarginPct(admin: AdminClient, workspaceId: string): Promise<number> {
  const { data } = await admin
    .from("workspace_financial_settings")
    .select("tax_pct, product_cost_pct, other_expenses_pct, frete_pct, desconto_pct")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const row = (data || {}) as Record<string, unknown>;
  return Math.max(
    0,
    100 -
      toNumber(row.tax_pct, 6) -
      toNumber(row.product_cost_pct, 25) -
      toNumber(row.other_expenses_pct, 5) -
      toNumber(row.frete_pct, 6) -
      toNumber(row.desconto_pct, 6)
  );
}

function attributionWindowForRun(treatment: ContactListRow) {
  const playbookId = String(treatment.auto_segment?.playbook_id || "");
  const days = playbookAttributionWindowDays(playbookId);
  const start = parseDate(treatment.created_at);
  const end = start ? new Date(start.getTime() + days * DAY_MS) : null;

  return { playbookId, days, start, end };
}

export async function POST(request: NextRequest) {
  const { auth, error } = await authRoute(request);
  if (error) return error;

  try {
    const body = await request.json();
    const playbookId = String(body.playbookId || "");
    if (!PLAYBOOK_LABELS[playbookId]) {
      return NextResponse.json({ error: "Playbook invalido" }, { status: 400 });
    }

    const holdoutPct = Math.min(30, Math.max(0, Number(body.holdoutPct ?? 10)));
    const sourceRunId = cleanSourceRunId(body.sourceRunId);
    const sourceDecision = cleanSourceDecision(body.sourceDecision);
    const runId = randomUUID();
    const now = new Date();
    const playbookName = PLAYBOOK_LABELS[playbookId];
    const attributionWindowDays = playbookAttributionWindowDays(playbookId);
    const audience = await buildAudience(auth!.admin, auth!.workspaceId, playbookId);

    if (audience.length === 0) {
      return NextResponse.json({ error: "Audiencia vazia para este playbook" }, { status: 400 });
    }

    const treatment: Contact[] = [];
    const holdout: Contact[] = [];
    for (const contact of audience) {
      if (hashPercent(contact.key, runId) < holdoutPct) {
        holdout.push(publicContact(contact));
      } else {
        treatment.push(publicContact(contact));
      }
    }

    if (treatment.length === 0) {
      return NextResponse.json({ error: "Holdout deixou a lista de tratamento vazia" }, { status: 400 });
    }

    const dateLabel = now.toISOString().slice(0, 10);
    const baseAutoSegment = {
      type: "retention_playbook",
      run_id: runId,
      playbook_id: playbookId,
      playbook_name: playbookName,
      holdout_pct: holdoutPct,
      ...(sourceRunId ? { source_run_id: sourceRunId } : {}),
      ...(sourceDecision ? { source_decision: sourceDecision } : {}),
      created_at: now.toISOString(),
    };
    const sourceDescription = sourceRunId
      ? ` Escala/aprendizado a partir do run ${sourceRunId}.`
      : "";

    const treatmentList = await createList({
      admin: auth!.admin,
      workspaceId: auth!.workspaceId,
      userId: auth!.userId,
      name: `Playbook ${playbookName} ${dateLabel} Tratamento`,
      description: `Tratamento do playbook ${playbookName}. Run ${runId}.${sourceDescription}`,
      contacts: treatment,
      autoSegment: { ...baseAutoSegment, role: "treatment" },
    });

    const holdoutList =
      holdout.length > 0
        ? await createList({
            admin: auth!.admin,
            workspaceId: auth!.workspaceId,
            userId: auth!.userId,
            name: `Playbook ${playbookName} ${dateLabel} Holdout`,
            description: `Grupo de controle do playbook ${playbookName}. Nao disparar campanha. Run ${runId}.${sourceDescription}`,
            contacts: holdout,
            autoSegment: { ...baseAutoSegment, role: "holdout" },
          })
        : null;

    return NextResponse.json({
      run: {
        id: runId,
        playbookId,
        playbookName,
        createdAt: now.toISOString(),
        sourceRunId: sourceRunId || null,
        sourceDecision: sourceDecision || null,
        holdoutPct,
        audienceCount: audience.length,
        treatmentList,
        holdoutList,
        links: {
          whatsapp: withParams(
            "/crm/whatsapp",
            whatsappPlaybookParams({
              listId: treatmentList.id,
              campaignName: `Playbook ${playbookName} ${dateLabel}`,
              playbookId,
              playbookName,
              runId,
              audienceName: treatmentList.name,
              attributionWindowDays,
            })
          ),
          lists: withParams("/crm/listas", { list: treatmentList.id }),
          email: withParams("/crm/listas", {
            email: treatmentList.id,
            run: runId,
            playbook: playbookId,
            playbook_name: playbookName,
            audience: treatmentList.name,
          }),
          coupons: withParams("/coupons", {
            playbook: playbookId,
            run: runId,
            name: `Cupom ${playbookName} ${dateLabel}`,
            ...couponGuardrailParams(playbookId),
          }),
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Retention Playbooks] create run error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { auth, error } = await authRoute(request);
  if (error) return error;

  try {
    const { data, error: listError } = await auth!.admin
      .from("crm_contact_lists")
      .select("*")
      .eq("workspace_id", auth!.workspaceId)
      .eq("auto_segment->>type", "retention_playbook")
      .order("created_at", { ascending: false })
      .limit(80);

    if (listError) throw listError;
    const lists = ((data || []) as ContactListRow[]).filter((list) => list.auto_segment?.run_id);
    const byRun = new Map<string, { treatment?: ContactListRow; holdout?: ContactListRow }>();

    for (const list of lists) {
      const runId = list.auto_segment?.run_id;
      if (!runId) continue;
      const group = byRun.get(runId) || {};
      if (list.auto_segment?.role === "treatment") group.treatment = list;
      if (list.auto_segment?.role === "holdout") group.holdout = list;
      byRun.set(runId, group);
    }

    const groups = [...byRun.entries()]
      .filter(([, group]) => group.treatment)
      .slice(0, 20);

    if (groups.length === 0) {
      return NextResponse.json({ runs: [] });
    }

    const since = groups
      .map(([, group]) => group.treatment!.created_at)
      .sort()[0];
    const runIds = new Set(groups.map(([runId]) => runId));
    const locawebListIds = new Set(
      groups
        .map(([, group]) => group.treatment!.locaweb_list_id)
        .filter((id): id is string => Boolean(id))
    );
    const [sales, marginPct, waCampaigns, emailDispatches, couponAudits, cashbackUsages] = await Promise.all([
      fetchSalesSince(auth!.admin, auth!.workspaceId, since),
      contributionMarginPct(auth!.admin, auth!.workspaceId),
      fetchWaCampaignsSince(auth!.admin, auth!.workspaceId, since, runIds),
      fetchEmailDispatchesSince(auth!.admin, auth!.workspaceId, since, locawebListIds),
      fetchCouponAuditsSince(auth!.admin, auth!.workspaceId, since, runIds),
      fetchCashbackUsagesSince(auth!.admin, auth!.workspaceId, since),
    ]);
    const couponPlanIds = new Set(
      couponAudits
        .map((audit) => audit.plan_id)
        .filter((id): id is string => Boolean(id))
    );
    const activeCoupons = await fetchActiveCouponsForPlans(
      auth!.admin,
      auth!.workspaceId,
      couponPlanIds
    );

    const runs = groups.map(([runId, group]) => {
      const treatment = group.treatment!;
      const holdout = group.holdout;
      const attribution = attributionWindowForRun(treatment);
      const runSales = sales.filter((sale) => {
        const saleDate = parseDate(sale.data_compra);
        return (
          saleDate &&
          attribution.start &&
          attribution.end &&
          saleDate >= attribution.start &&
          saleDate <= attribution.end
        );
      });
      const treatmentMetrics = summarizeSalesForList(treatment, runSales, marginPct);
      const holdoutMetrics = summarizeSalesForList(holdout, runSales, marginPct);
      const liftConversion = treatmentMetrics.conversionRate - holdoutMetrics.conversionRate;
      const liftRevenuePerContact =
        treatmentMetrics.revenuePerContact - holdoutMetrics.revenuePerContact;
      const incrementalRevenue = Math.max(0, liftRevenuePerContact * treatment.total_count);
      const whatsapp = summarizeWaCampaigns(runId, waCampaigns);
      const email = summarizeEmailDispatches(treatment, emailDispatches, runId, attribution);
      const coupons = summarizeCoupons(runId, couponAudits, activeCoupons);
      const runCashbackUsages = cashbackUsages.filter((usage) => {
        const usageDate = parseDate(usage.usado_em);
        return (
          usageDate &&
          attribution.start &&
          attribution.end &&
          usageDate >= attribution.start &&
          usageDate <= attribution.end
        );
      });
      const cashback = summarizeCashbackUsage(treatment, holdout, runCashbackUsages);
      const couponCreationLink = withParams("/coupons", {
        playbook: attribution.playbookId,
        run: runId,
        name: `Cupom ${treatment.auto_segment?.playbook_name || "Retencao"}`,
        ...couponGuardrailParams(attribution.playbookId),
      });
      const trackedCashbackCost = cashback.incrementalCashbackValue;
      const trackedOfferCost = coupons.attributedDiscount + trackedCashbackCost;
      const trackedTotalCost = whatsapp.costBrl + trackedOfferCost;
      const incrementalContribution =
        incrementalRevenue * (marginPct / 100) - trackedTotalCost;

      return {
        id: runId,
        playbookId: attribution.playbookId,
        playbookName: treatment.auto_segment?.playbook_name || treatment.name,
        createdAt: treatment.created_at,
        attributionWindowDays: attribution.days,
        attributionEndsAt: attribution.end?.toISOString() || null,
        sourceRunId: treatment.auto_segment?.source_run_id || null,
        sourceDecision: treatment.auto_segment?.source_decision || null,
        treatmentList: {
          id: treatment.id,
          name: treatment.name,
          totalCount: treatment.total_count,
          phoneCount: treatment.phone_count,
          emailCount: treatment.email_count,
          locawebListId: treatment.locaweb_list_id,
        },
        holdoutList: holdout
          ? {
              id: holdout.id,
              name: holdout.name,
              totalCount: holdout.total_count,
              phoneCount: holdout.phone_count,
              emailCount: holdout.email_count,
              locawebListId: holdout.locaweb_list_id,
            }
          : null,
        metrics: {
          treatment: treatmentMetrics,
          holdout: holdoutMetrics,
          liftConversion,
          incrementalRevenue,
          incrementalContribution,
          trackedChannelCost: whatsapp.costBrl,
          trackedCashbackCost,
          trackedOfferCost,
          trackedTotalCost,
        },
        channels: {
          whatsapp,
          email,
          coupons,
          cashback,
        },
        links: {
          whatsapp: withParams(
            "/crm/whatsapp",
            whatsappPlaybookParams({
              listId: treatment.id,
              campaignName: `Playbook ${treatment.auto_segment?.playbook_name || "Retencao"}`,
              playbookId: attribution.playbookId,
              playbookName: treatment.auto_segment?.playbook_name || "Retencao",
              runId,
              audienceName: treatment.name,
              attributionWindowDays: attribution.days,
            })
          ),
          lists: withParams("/crm/listas", { list: treatment.id }),
          email: withParams("/crm/listas", {
            email: treatment.id,
            run: runId,
            playbook: attribution.playbookId,
            playbook_name: treatment.auto_segment?.playbook_name || "Retencao",
            audience: treatment.name,
          }),
          coupons: coupons.planCount > 0 ? "/coupons" : couponCreationLink,
        },
      };
    });

    return NextResponse.json({ runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Retention Playbooks] list runs error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
