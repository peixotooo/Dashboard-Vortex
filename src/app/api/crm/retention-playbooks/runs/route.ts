import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authRoute } from "@/lib/cashback/route-helpers";
import { getGA4Report } from "@/lib/ga4-api";
import { filterContacts } from "@/lib/wa-compliance";
import {
  createTemplateOnMeta,
  extractTemplateVariables,
  getWaConfig,
  getTemplateBodyText,
  type WaTemplateComponent,
} from "@/lib/whatsapp-api";

export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;
const HARD_CAP = 120000;
const RETENTION_AUTOPILOT_TEMPLATE_PREFIX = "bkng_account_update_v";
const RETENTION_AUTOPILOT_TEMPLATE_BODY =
  "Ola {{1}}, tudo bem?\n\n{{2}}\n\nCaso precise de ajuda, responda esta mensagem.";
const RETENTION_AUTOPILOT_TEMPLATE_EXAMPLE_BODY_TEXT = [
  [
    "Mariana",
    "Seu atendimento foi atualizado. Caso precise de ajuda, responda esta mensagem.",
  ],
];

type AdminClient = SupabaseClient;

interface CrmOrderRow {
  cpf: string | null;
  email: string | null;
  cliente: string | null;
  telefone: string | null;
  valor: number | string | null;
  cupom?: string | null;
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
  template_id: string | null;
  template_name: string | null;
  template_language: string | null;
  variable_values: Record<string, string> | null;
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
    desired_send_hour?: number | string;
    send_hour_source?: string;
    send_hour_reason?: string;
    paused_reason?: string;
    recommended_send_day?: number | string;
    recommendation_goal?: RecommendationGoal;
  } | null;
  wa_templates:
    | {
        name: string;
        language: string | null;
        category: string | null;
        status: string | null;
        components: WaTemplateComponent[] | null;
      }
    | Array<{
        name: string;
        language: string | null;
        category: string | null;
        status: string | null;
        components: WaTemplateComponent[] | null;
      }>
    | null;
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
    reason?: string;
    job_status?: "queued" | "running" | "succeeded" | "failed";
    result?: {
      proposed?: number | string | null;
      auto_approved?: number | string | null;
    } | null;
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
  discount_unit: "pct" | "brl" | string | null;
  discount_value_brl: number | string | null;
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

type GoalStatus = "em_leitura" | "bateu" | "parcial" | "nao_bateu";
type ConfidenceLabel = "baixa" | "media" | "alta";

interface PlaybookForecast {
  expectedOrders: number;
  revenue: number;
  contribution: number;
  incentiveBudget: number;
  channelCost: number;
  totalCost: number;
  conversionPct: number;
}

interface LearningApplied {
  multiplier: number;
  sampleSize: number;
  confidence: ConfidenceLabel;
  note: string;
  lastStatus: GoalStatus | null;
  negativeSignals: number;
}

interface RecommendationConfidence {
  score: number;
  label: ConfidenceLabel;
  reason: string;
}

interface RecommendationGoal {
  version: 1;
  createdAt: string;
  playbookId: string;
  playbookName: string;
  reason: string;
  forecast: PlaybookForecast;
  target: {
    orders: number;
    revenue: number;
    contribution: number;
    liftConversionPositive: boolean;
    windowDays: number;
    dueAt: string;
  };
  confidence: RecommendationConfidence;
  learningApplied: LearningApplied;
  criteria: string;
}

interface GoalResult {
  status: GoalStatus;
  label: string;
  reason: string;
  evaluatedAt: string;
  target: RecommendationGoal["target"] | null;
  actual: {
    orders: number;
    revenue: number;
    contribution: number;
    liftConversion: number;
  };
  deltaPct: {
    orders: number | null;
    revenue: number | null;
    contribution: number | null;
  };
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
    recommendation_goal?: RecommendationGoal;
    created_at?: string;
  } | null;
}

interface WaTemplateRow {
  id: string;
  name: string;
  language: string | null;
  category: string | null;
  status: string;
  components: WaTemplateComponent[];
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

function cleanText(value: unknown, fallback = "", max = 600) {
  const text = String(value ?? fallback).trim();
  return (text || fallback).slice(0, max);
}

function cleanConfidence(raw: unknown): RecommendationConfidence {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const score = Math.min(100, Math.max(0, Math.round(toNumber(input.score, 50))));
  const label = ["baixa", "media", "alta"].includes(String(input.label))
    ? (String(input.label) as ConfidenceLabel)
    : score >= 78
      ? "alta"
      : score >= 55
        ? "media"
        : "baixa";
  return {
    score,
    label,
    reason: cleanText(input.reason, "Confianca calculada automaticamente.", 300),
  };
}

function cleanLearning(raw: unknown): LearningApplied {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const lastStatus = ["em_leitura", "bateu", "parcial", "nao_bateu"].includes(String(input.lastStatus))
    ? (String(input.lastStatus) as GoalStatus)
    : null;
  return {
    multiplier: Math.min(1.4, Math.max(0.5, toNumber(input.multiplier, 1))),
    sampleSize: Math.max(0, Math.round(toNumber(input.sampleSize, 0))),
    confidence: ["baixa", "media", "alta"].includes(String(input.confidence))
      ? (String(input.confidence) as ConfidenceLabel)
      : "baixa",
    note: cleanText(input.note, "Sem aprendizado fechado para este playbook.", 300),
    lastStatus,
    negativeSignals: Math.max(0, Math.round(toNumber(input.negativeSignals, 0))),
  };
}

function cleanForecast(raw: unknown): PlaybookForecast {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const incentiveBudget = Math.max(0, toNumber(input.incentiveBudget));
  const channelCost = Math.max(0, toNumber(input.channelCost));
  return {
    expectedOrders: Math.max(0, Math.round(toNumber(input.expectedOrders))),
    revenue: Math.max(0, toNumber(input.revenue)),
    contribution: toNumber(input.contribution),
    incentiveBudget,
    channelCost,
    totalCost: Math.max(0, toNumber(input.totalCost, incentiveBudget + channelCost)),
    conversionPct: Math.max(0, toNumber(input.conversionPct)),
  };
}

function cleanRecommendationGoal(
  raw: unknown,
  playbookId: string,
  playbookName: string,
  now: Date,
  attributionWindowDays: number
): RecommendationGoal | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const forecast = cleanForecast(input.forecast);
  const targetInput =
    input.target && typeof input.target === "object" && !Array.isArray(input.target)
      ? (input.target as Record<string, unknown>)
      : {};
  const dueAtRaw = cleanText(targetInput.dueAt, "", 80);
  const dueAtDate = dueAtRaw ? parseDate(dueAtRaw) : null;
  const dueAt =
    dueAtDate?.toISOString() ||
    new Date(now.getTime() + attributionWindowDays * DAY_MS).toISOString();

  return {
    version: 1,
    createdAt: cleanText(input.createdAt, now.toISOString(), 80),
    playbookId,
    playbookName,
    reason: cleanText(input.reason, "Recomendacao automatica por margem, base e custo de recompra.", 500),
    forecast,
    target: {
      orders: Math.max(0, Math.round(toNumber(targetInput.orders, forecast.expectedOrders))),
      revenue: Math.max(0, toNumber(targetInput.revenue, forecast.revenue)),
      contribution: Math.max(0, toNumber(targetInput.contribution, forecast.contribution)),
      liftConversionPositive: true,
      windowDays: Math.max(1, Math.round(toNumber(targetInput.windowDays, attributionWindowDays))),
      dueAt,
    },
    confidence: cleanConfidence(input.confidence),
    learningApplied: cleanLearning(input.learningApplied),
    criteria: cleanText(
      input.criteria,
      "Bateu se a MC liquida atingir a meta e o lift de conversao for positivo ao fechar a janela.",
      500
    ),
  };
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

function deltaPct(actual: number, target: number): number | null {
  if (!Number.isFinite(target) || target <= 0) return null;
  return ((actual - target) / target) * 100;
}

function goalStatusLabel(status: GoalStatus) {
  if (status === "bateu") return "Bateu";
  if (status === "parcial") return "Parcial";
  if (status === "nao_bateu") return "Nao bateu";
  return "Em leitura";
}

function incrementalOrdersForRun(
  treatment: ContactListRow,
  holdout: ContactListRow | null | undefined,
  treatmentOrders: number,
  holdoutOrders: number
) {
  if (!holdout || treatment.total_count <= 0 || holdout.total_count <= 0) return Math.max(0, treatmentOrders);
  const liftOrdersPerContact =
    treatmentOrders / treatment.total_count - holdoutOrders / holdout.total_count;
  return Math.max(0, Math.round(liftOrdersPerContact * treatment.total_count));
}

function evaluateGoalResult(params: {
  goal: RecommendationGoal | null | undefined;
  attributionEnd: Date | null;
  hasHoldout: boolean;
  hasMeasurement: boolean;
  actualOrders: number;
  actualRevenue: number;
  actualContribution: number;
  liftConversion: number;
}): GoalResult {
  const now = new Date();
  const target = params.goal?.target || null;
  const actual = {
    orders: params.actualOrders,
    revenue: params.actualRevenue,
    contribution: params.actualContribution,
    liftConversion: params.liftConversion,
  };
  const deltas = {
    orders: target ? deltaPct(actual.orders, target.orders) : null,
    revenue: target ? deltaPct(actual.revenue, target.revenue) : null,
    contribution: target ? deltaPct(actual.contribution, target.contribution) : null,
  };

  if (!params.goal || !target) {
    return {
      status: "em_leitura",
      label: "Em leitura",
      reason: "Run antigo ou preparado sem meta automatica gravada.",
      evaluatedAt: now.toISOString(),
      target,
      actual,
      deltaPct: deltas,
    };
  }

  const dueAt = parseDate(target.dueAt) || params.attributionEnd;
  if (!params.hasHoldout || !params.hasMeasurement) {
    return {
      status: "em_leitura",
      label: "Em leitura",
      reason: "Falta holdout ou canal mensuravel para fechar a leitura.",
      evaluatedAt: now.toISOString(),
      target,
      actual,
      deltaPct: deltas,
    };
  }

  if (!dueAt || dueAt > now) {
    return {
      status: "em_leitura",
      label: "Em leitura",
      reason: "Janela de atribuicao ainda aberta.",
      evaluatedAt: now.toISOString(),
      target,
      actual,
      deltaPct: deltas,
    };
  }

  const status: GoalStatus =
    actual.contribution >= target.contribution && actual.liftConversion > 0
      ? "bateu"
      : actual.contribution <= 0 || actual.liftConversion <= 0
        ? "nao_bateu"
        : "parcial";
  const reason =
    status === "bateu"
      ? "MC liquida atingiu a meta e o lift foi positivo."
      : status === "parcial"
        ? "MC ficou positiva, mas abaixo da meta definida no preparo."
        : "MC ou lift nao sustentaram escala ao fechar a janela.";

  return {
    status,
    label: goalStatusLabel(status),
    reason,
    evaluatedAt: now.toISOString(),
    target,
    actual,
    deltaPct: deltas,
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
      .select("cpf, email, cliente, telefone, valor, cupom, data_compra, source_order_id, numero_pedido")
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
        "id, name, status, template_id, template_name, template_language, variable_values, total_messages, sent_count, delivered_count, read_count, failed_count, message_cost_usd, exchange_rate, created_at, scheduled_at, started_at, completed_at, segment_filter, wa_templates(name, language, category, status, components)"
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

function normalizeJoinedTemplate(template: WaCampaignRow["wa_templates"]) {
  if (Array.isArray(template)) return template[0] || null;
  return template || null;
}

function renderCampaignMessage(campaign: WaCampaignRow) {
  const template = normalizeJoinedTemplate(campaign.wa_templates);
  const body = getTemplateBodyText(template?.components || []);
  const variableValues = campaign.variable_values || {};
  if (!body) return "";

  return renderTemplatePreview(body, variableValues);
}

function renderTemplatePreview(body: string, variableValues: Record<string, string>) {
  return body.replace(/\{\{(\d+)\}\}/g, (match) => {
    const value = variableValues[match] || "";
    if (!value) return match;
    return value
      .replace(/\{\{nome\}\}/g, "Nome do cliente")
      .replace(/\{\{saldo_cashback\}\}/g, "saldo do cliente")
      .replace(/\{\{dias_para_expirar\}\}/g, "dias restantes")
      .replace(/\{\{expira_em\}\}/g, "data de expiracao")
      .replace(/\{\{ultima_compra\}\}/g, "ultima compra")
      .replace(/\{\{dias_ultima_compra\}\}/g, "dias desde a ultima compra")
      .replace(/\{\{ticket_medio\}\}/g, "ticket medio")
      .replace(/\{\{total_compras\}\}/g, "total de compras");
  });
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
    campaigns: rows.slice(0, 5).map((campaign) => {
      const template = normalizeJoinedTemplate(campaign.wa_templates);
      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        templateName: campaign.template_name,
        templateLanguage: campaign.template_language || template?.language || null,
        templateCategory: template?.category || null,
        templateStatus: template?.status || null,
        templateBody: getTemplateBodyText(template?.components || []),
        messagePreview: renderCampaignMessage(campaign),
        sendHourSource: campaign.segment_filter?.send_hour_source || null,
        sendHourReason: campaign.segment_filter?.send_hour_reason || null,
        pausedReason: campaign.segment_filter?.paused_reason || null,
        desiredSendHour: toNumber(campaign.segment_filter?.desired_send_hour, 0),
        recommendedSendDay: toNumber(campaign.segment_filter?.recommended_send_day, -1),
        totalMessages: toNumber(campaign.total_messages),
        sent: toNumber(campaign.sent_count),
        costBrl:
          toNumber(campaign.sent_count) *
          toNumber(campaign.message_cost_usd, 0.0625) *
          toNumber(campaign.exchange_rate, 5.5),
        createdAt: campaign.created_at,
        scheduledAt: campaign.scheduled_at,
        startedAt: campaign.started_at,
        completedAt: campaign.completed_at,
      };
    }),
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
      .in("action", ["plan_created", "cron_picked", "cron_skipped"])
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
        "id, plan_id, status, vnda_coupon_code, attributed_revenue, attributed_units, discount_pct, discount_unit, discount_value_brl, expires_at, created_at"
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
  coupons: ActiveCouponRow[],
  sales: CrmOrderRow[]
) {
  const runAudits = audits.filter((audit) => audit.details?.playbook_run_id === runId);
  const planIds = new Set(
    runAudits
      .filter((audit) => audit.plan_id)
      .map((audit) => audit.plan_id as string)
  );
  const directCouponIds = new Set(
    runAudits
      .filter((audit) => audit.active_coupon_id)
      .map((audit) => audit.active_coupon_id as string)
  );
  const latestRunAudit =
    runAudits.find((audit) => audit.action === "cron_skipped") ||
    runAudits.find((audit) => audit.action === "cron_picked") ||
    null;
  const latestResult = latestRunAudit?.details?.result || null;
  const latestProposed = toNumber(latestResult?.proposed);
  const latestAutoApproved = toNumber(latestResult?.auto_approved);
  const latestReason = latestRunAudit?.details?.reason || null;
  const latestJobStatus = latestRunAudit?.details?.job_status || null;
  const latestRunStatus =
    latestReason === "no_candidates" ||
    (latestJobStatus === "succeeded" && latestRunAudit?.action === "cron_skipped" && latestProposed === 0)
      ? "no_candidates"
      : latestJobStatus || (latestRunAudit?.action === "cron_picked" ? "picked" : null);
  const rows =
    directCouponIds.size > 0
      ? coupons.filter((coupon) => directCouponIds.has(coupon.id))
      : coupons.filter((coupon) => coupon.plan_id && planIds.has(coupon.plan_id));
  const couponCodes = new Set(rows.map((coupon) => coupon.vnda_coupon_code.trim().toUpperCase()));
  const salesByCoupon = new Map<string, { revenue: number; units: number }>();
  for (const sale of sales) {
    const code = String(sale.cupom || "").trim().toUpperCase();
    if (!code || !couponCodes.has(code)) continue;
    const current = salesByCoupon.get(code) || { revenue: 0, units: 0 };
    current.revenue += toNumber(sale.valor);
    current.units += 1;
    salesByCoupon.set(code, current);
  }
  const couponDiscountAmount = (coupon: ActiveCouponRow) => {
    const code = coupon.vnda_coupon_code.trim().toUpperCase();
    const scopedAttribution = salesByCoupon.get(code) || { revenue: 0, units: 0 };
    if (coupon.discount_unit === "brl") {
      const configuredValueBrl = toNumber(coupon.discount_value_brl);
      const perUseDiscount = configuredValueBrl > 0 ? configuredValueBrl : toNumber(coupon.discount_pct);
      return perUseDiscount > 0 ? perUseDiscount * scopedAttribution.units : 0;
    }
    const attributedRevenue = scopedAttribution.revenue;
    const discountPct = Math.min(95, Math.max(0, toNumber(coupon.discount_pct)));
    const discountRate = discountPct / 100;
    return discountRate > 0
      ? attributedRevenue * (discountRate / Math.max(0.01, 1 - discountRate))
      : 0;
  };
  const totals = rows.reduce(
    (acc, coupon) => {
      const code = coupon.vnda_coupon_code.trim().toUpperCase();
      const scopedAttribution = salesByCoupon.get(code) || { revenue: 0, units: 0 };

      acc.attributedRevenue += scopedAttribution.revenue;
      acc.attributedUnits += scopedAttribution.units;
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
    planIds: Array.from(planIds),
    couponCount: rows.length,
    lastRunStatus: latestRunStatus,
    lastRunReason: latestReason,
    lastRunAt: latestRunAudit?.created_at || null,
    lastRunProposed: latestProposed,
    lastRunAutoApproved: latestAutoApproved,
    ...totals,
    coupons: rows.slice(0, 20).map((coupon) => ({
      id: coupon.id,
      code: coupon.vnda_coupon_code,
      status: coupon.status,
      discountPct: toNumber(coupon.discount_pct),
      discountUnit: coupon.discount_unit === "brl" ? "brl" : "pct",
      discountValueBrl: toNumber(coupon.discount_value_brl),
      attributedRevenue: salesByCoupon.get(coupon.vnda_coupon_code.trim().toUpperCase())?.revenue ?? 0,
      attributedUnits: salesByCoupon.get(coupon.vnda_coupon_code.trim().toUpperCase())?.units ?? 0,
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

function formatPhoneForWa(phone: string | undefined): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55")) return digits;
  return `55${digits}`;
}

function templateScore(template: WaTemplateRow, terms: string[]) {
  const haystack = templateHaystack(template);
  return terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
}

function templateHaystack(template: WaTemplateRow) {
  return `${template.name} ${template.category || ""} ${getTemplateBodyText(template.components || [])}`
    .toLowerCase();
}

function isReservedAutomationTemplate(template: WaTemplateRow) {
  const haystack = templateHaystack(template);
  return /cart|carrinho|abandonad|checkout|gift|presente|codigo|c[oó]digo|senha|token|otp|autentic/.test(
    haystack
  );
}

function isAutopilotRetentionTemplate(template: WaTemplateRow) {
  return (
    template.name.startsWith(RETENTION_AUTOPILOT_TEMPLATE_PREFIX) &&
    isGenericUtilityTemplate(template) &&
    !isReservedAutomationTemplate(template)
  );
}

function isGenericUtilityTemplate(template: WaTemplateRow) {
  const body = getTemplateBodyText(template.components || []).toLowerCase();
  const vars = extractTemplateVariables(template.components || []);
  return (
    vars.includes("{{1}}") &&
    vars.includes("{{2}}") &&
    /ol[aá]|tudo bem|qualquer coisa|responder/.test(body) &&
    !/codigo|c[oó]digo|senha|token|otp/.test(body)
  );
}

function isGenericRetentionUtilityTemplate(template: WaTemplateRow) {
  const haystack = templateHaystack(template);
  return (
    (isGenericUtilityTemplate(template) || isAutopilotRetentionTemplate(template)) &&
    !isReservedAutomationTemplate(template) &&
    (/retenc|recompra|winback|dormant|dormante|cashback|saldo|cliente|vip/.test(haystack) ||
      template.name.startsWith(RETENTION_AUTOPILOT_TEMPLATE_PREFIX))
  );
}

async function ensurePendingRetentionUtilityTemplate(admin: AdminClient, workspaceId: string) {
  const { data: existing, error: existingError } = await admin
    .from("wa_templates")
    .select("id, name, language, category, status, components")
    .eq("workspace_id", workspaceId)
    .like("name", `${RETENTION_AUTOPILOT_TEMPLATE_PREFIX}%`)
    .neq("status", "REJECTED")
    .order("created_at", { ascending: false })
    .limit(1);

  if (existingError) throw existingError;
  const reusable = ((existing || []) as WaTemplateRow[]).find((template) =>
    Array.isArray(template.components)
  );
  if (reusable) return { template: reusable, created: false };

  const config = await getWaConfig(workspaceId);
  if (!config) {
    return { template: null, created: false, reason: "WhatsApp nao configurado para este workspace." };
  }

  const name = `${RETENTION_AUTOPILOT_TEMPLATE_PREFIX}${Math.floor(Date.now() / 1000)}`;
  const language = "pt_BR";
  const category = "UTILITY";
  const components = [
    {
      type: "BODY",
      text: RETENTION_AUTOPILOT_TEMPLATE_BODY,
      example: { body_text: RETENTION_AUTOPILOT_TEMPLATE_EXAMPLE_BODY_TEXT },
    },
  ];

  let metaResult: { id: string; status?: string; category?: string };
  try {
    metaResult = await createTemplateOnMeta(config, {
      name,
      language,
      category,
      components,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(
      "[Retention Autopilot UtilityTemplate] Meta create failed:",
      message,
      "| sent:",
      JSON.stringify({ name, language, category, components })
    );
    return { template: null, created: false, reason: `Meta recusou o template neutro: ${message}` };
  }

  const { data: template, error } = await admin
    .from("wa_templates")
    .insert({
      workspace_id: workspaceId,
      meta_id: metaResult.id,
      name,
      language,
      category: metaResult.category || category,
      status: metaResult.status || "PENDING",
      components,
      synced_at: new Date().toISOString(),
    })
    .select("id, name, language, category, status, components")
    .single();

  if (error || !template) {
    return {
      template: null,
      created: true,
      reason: `Template criado na Meta, mas nao persistiu localmente: ${error?.message || "erro desconhecido"}`,
    };
  }

  return { template: template as WaTemplateRow, created: true };
}

async function pickApprovedUtilityTemplate(
  admin: AdminClient,
  workspaceId: string,
  playbookId: string
) {
  const context = WHATSAPP_PLAYBOOK_CONTEXT[playbookId];
  const terms = (context?.templateHint || "cashback retencao")
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  const { data, error } = await admin
    .from("wa_templates")
    .select("id, name, language, category, status, components")
    .eq("workspace_id", workspaceId)
    .eq("status", "APPROVED")
    .eq("category", "UTILITY");

  if (error) throw error;
  const templates = ((data || []) as WaTemplateRow[]).filter(
    (template) => Array.isArray(template.components) && !isReservedAutomationTemplate(template)
  );
  if (templates.length === 0) return null;

  const scored = templates
    .map((template) => ({ template, score: templateScore(template, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.template.name.localeCompare(b.template.name))
    .map((item) => item.template);

  const candidates = [
    ...scored,
    ...templates.filter(isGenericRetentionUtilityTemplate).sort((a, b) => a.name.localeCompare(b.name)),
  ];
  const seen = new Set<string>();

  for (const template of candidates) {
    if (seen.has(template.id)) continue;
    seen.add(template.id);
    const vars = extractTemplateVariables(template.components || []);
    const defaults = buildAutopilotVariableDefaults(playbookId, template, vars);
    const hasAllVars = vars.every((variable) => defaults[variable]);
    if (hasAllVars) return template;
  }

  return null;
}

function templateVariableContext(templateBody: string, variable: string): string {
  const index = templateBody.indexOf(variable);
  if (index < 0) return "";
  return templateBody.slice(Math.max(0, index - 48), index + variable.length + 48).toLowerCase();
}

function buildAutopilotVariableDefaults(
  playbookId: string,
  template: WaTemplateRow,
  vars: string[]
): Record<string, string> {
  if (isGenericRetentionUtilityTemplate(template)) {
    const genericDefaults: Record<string, string> = {};
    for (const variable of vars) {
      if (variable === "{{1}}") genericDefaults[variable] = "{{nome}}";
      if (variable === "{{2}}") genericDefaults[variable] = playbookRuntimeMessage(playbookId);
    }
    return genericDefaults;
  }

  const body = getTemplateBodyText(template.components || []);
  const isCashbackPlaybook =
    playbookId === "cashback-expiring-14d" ||
    playbookId === "active-cashback-balance";
  const defaults: Record<string, string> = {};

  for (const variable of vars) {
    const position = Number(variable.replace(/\D/g, ""));
    const around = templateVariableContext(body, variable);

    if (position === 1 || /nome|cliente|oi|ola|olá/.test(around)) {
      defaults[variable] = "{{nome}}";
      continue;
    }

    if (isCashbackPlaybook && /saldo|cashback|r\$|valor/.test(around)) {
      defaults[variable] = "{{saldo_cashback}}";
      continue;
    }

    if (isCashbackPlaybook && /dia|expir|vence|valid/.test(around)) {
      defaults[variable] = around.includes("dia") ? "{{dias_para_expirar}}" : "{{expira_em}}";
      continue;
    }

    if (/ultima|última/.test(around)) {
      defaults[variable] = "{{ultima_compra}}";
      continue;
    }

    if (/dia/.test(around)) {
      defaults[variable] = "{{dias_ultima_compra}}";
      continue;
    }

    if (/ticket/.test(around)) {
      defaults[variable] = "{{ticket_medio}}";
      continue;
    }

    if (/compra/.test(around)) {
      defaults[variable] = "{{total_compras}}";
    }
  }

  return defaults;
}

async function fetchTemplateById(
  admin: AdminClient,
  workspaceId: string,
  templateId: string
): Promise<WaTemplateRow | null> {
  if (!templateId) return null;
  const { data, error } = await admin
    .from("wa_templates")
    .select("id, name, language, category, status, components")
    .eq("workspace_id", workspaceId)
    .eq("id", templateId)
    .maybeSingle();

  if (error) throw error;
  if (!data || !Array.isArray((data as WaTemplateRow).components)) return null;
  const template = data as WaTemplateRow;
  if (isReservedAutomationTemplate(template)) return null;
  if (template.category && template.category !== "UTILITY") return null;
  return template;
}

async function findPreviewTemplate(admin: AdminClient, workspaceId: string, playbookId: string) {
  const approved = await pickApprovedUtilityTemplate(admin, workspaceId, playbookId);
  if (approved) return approved;

  const { data, error } = await admin
    .from("wa_templates")
    .select("id, name, language, category, status, components")
    .eq("workspace_id", workspaceId)
    .like("name", `${RETENTION_AUTOPILOT_TEMPLATE_PREFIX}%`)
    .neq("status", "REJECTED")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  const existing = ((data || []) as WaTemplateRow[]).find((template) =>
    Array.isArray(template.components)
  );
  if (existing) return existing;

  return {
    id: "",
    name: "template_utility_neutro",
    language: "pt_BR",
    category: "UTILITY",
    status: "DRAFT",
    components: [
      {
        type: "BODY",
        text: RETENTION_AUTOPILOT_TEMPLATE_BODY,
      } as WaTemplateComponent,
    ],
  } satisfies WaTemplateRow;
}

function cleanScheduleVariableValues(
  raw: unknown,
  vars: string[],
  defaults: Record<string, string>
) {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const cleaned: Record<string, string> = {};
  for (const variable of vars) {
    const value = Object.prototype.hasOwnProperty.call(input, variable)
      ? String(input[variable] ?? "")
      : defaults[variable] || "";
    cleaned[variable] = value.trim().slice(0, 1200);
  }
  return cleaned;
}

function buildTemplateContacts(
  contacts: Contact[],
  vars: string[],
  variableValues: Record<string, string>
) {
  return contacts
    .filter((contact) => contact.phone)
    .map((contact) => ({
      phone: formatPhoneForWa(contact.phone),
      name: contact.name || "",
      variables: Object.fromEntries(
        vars.map((variable) => [variable, resolveTemplateValue(variableValues[variable], contact)])
      ),
    }))
    .filter((contact) => contact.phone && vars.every((variable) => String(contact.variables[variable] || "").trim()));
}

async function getRunLists(
  admin: AdminClient,
  workspaceId: string,
  runId: string
): Promise<{ treatment: ContactListRow; holdout: ContactListRow | null; playbookId: string; playbookName: string }> {
  const { data, error } = await admin
    .from("crm_contact_lists")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("auto_segment->>type", "retention_playbook")
    .eq("auto_segment->>run_id", runId)
    .limit(5);

  if (error) throw error;
  const lists = (data || []) as ContactListRow[];
  const treatment = lists.find((list) => list.auto_segment?.role === "treatment");
  const holdout = lists.find((list) => list.auto_segment?.role === "holdout") || null;
  if (!treatment || !treatment.auto_segment?.playbook_id) {
    throw new Error("Run preparado nao encontrado ou sem lista de tratamento.");
  }

  return {
    treatment,
    holdout,
    playbookId: treatment.auto_segment.playbook_id,
    playbookName: treatment.auto_segment.playbook_name || PLAYBOOK_LABELS[treatment.auto_segment.playbook_id] || treatment.name,
  };
}

async function fetchActiveCampaignForPlaybook(
  admin: AdminClient,
  workspaceId: string,
  playbookId: string,
  excludeRunId?: string
) {
  const { data, error } = await admin
    .from("wa_campaigns")
    .select("id, name, status, total_messages, sent_count, segment_filter")
    .eq("workspace_id", workspaceId)
    .eq("segment_filter->>playbook_id", playbookId)
    .in("status", ["scheduled", "queued", "sending", "pending_template", "paused"])
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) throw error;
  return ((data || []) as Array<{
    id: string;
    name: string;
    status: string;
    total_messages: number | string | null;
    sent_count: number | string | null;
    segment_filter: { playbook_run_id?: string } | null;
  }>).find((campaign) => campaign.segment_filter?.playbook_run_id !== excludeRunId) || null;
}

async function fetchActiveCampaignForRun(admin: AdminClient, workspaceId: string, runId: string) {
  const { data, error } = await admin
    .from("wa_campaigns")
    .select("id, name, status, scheduled_at, total_messages, sent_count, template_name")
    .eq("workspace_id", workspaceId)
    .eq("segment_filter->>playbook_run_id", runId)
    .in("status", ["scheduled", "queued", "sending", "pending_template", "paused"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return ((data || []) as Array<{
    id: string;
    name: string;
    status: string;
    scheduled_at: string | null;
    total_messages: number | string | null;
    sent_count: number | string | null;
    template_name: string | null;
  }>)[0] || null;
}

async function buildSchedulePreview(params: {
  admin: AdminClient;
  workspaceId: string;
  runId: string;
  variableValues?: Record<string, string>;
  templateId?: string;
}) {
  const run = await getRunLists(params.admin, params.workspaceId, params.runId);
  const template =
    (await fetchTemplateById(params.admin, params.workspaceId, params.templateId || "")) ||
    (await findPreviewTemplate(params.admin, params.workspaceId, run.playbookId));
  const vars = extractTemplateVariables(template.components || []);
  const defaults = buildAutopilotVariableDefaults(run.playbookId, template, vars);
  const variableValues = cleanScheduleVariableValues(params.variableValues, vars, defaults);
  const missingVars = vars.filter((variable) => !variableValues[variable]);
  if (missingVars.length > 0) {
    throw new Error(`Preencha ${missingVars.join(", ")} antes de agendar.`);
  }

  const rawContacts = buildTemplateContacts(run.treatment.contacts || [], vars, variableValues);
  const compliance = await filterContacts(params.workspaceId, rawContacts, 7);
  const sendWindow = await inferBestSendWindow(params.admin, params.workspaceId);
  const body = getTemplateBodyText(template.components || []);

  return {
    runId: params.runId,
    playbookId: run.playbookId,
    playbookName: run.playbookName,
    treatmentListId: run.treatment.id,
    treatmentCount: run.treatment.total_count,
    holdoutCount: run.holdout?.total_count || 0,
    originalContacts: rawContacts.length,
    recipients: compliance.allowed.length,
    cooldownCount: compliance.cooldownCount,
    blockedCount: compliance.blockedCount,
    templateId: template.id || null,
    templateName: template.name,
    templateLanguage: template.language,
    templateCategory: template.category,
    templateStatus: template.status,
    templateBody: body,
    variables: vars.map((variable) => ({
      key: variable,
      value: variableValues[variable] || "",
    })),
    variableValues,
    messagePreview: renderTemplatePreview(body, variableValues),
    scheduledAt: sendWindow.scheduledAt,
    sendHour: sendWindow.hour,
    sendHourSource: sendWindow.source,
    sendHourReason: sendWindow.reason,
    goal: run.treatment.auto_segment?.recommendation_goal || null,
  };
}

function playbookRuntimeMessage(playbookId: string) {
  if (playbookId === "cashback-expiring-14d") {
    return "Voce tem R$ {{saldo_cashback}} de cashback disponivel e ele vence em {{dias_para_expirar}} dias. Use antes de expirar; o saldo ja esta na sua conta.";
  }
  if (playbookId === "active-cashback-balance") {
    return "Voce tem R$ {{saldo_cashback}} de cashback disponivel para usar na proxima compra. O saldo ja esta ativo na sua conta.";
  }
  if (playbookId === "second-purchase-31-60d") {
    return "Faz {{dias_ultima_compra}} dias desde sua ultima compra. Separei uma selecao para facilitar sua proxima recompra, sem precisar de cupom novo.";
  }
  if (playbookId === "one-time-61-90d-save") {
    return "Faz {{dias_ultima_compra}} dias desde sua compra. Se quiser voltar, sua conta ja esta pronta para uma nova compra com as novidades da Bulking.";
  }
  if (playbookId === "repeat-61-180d") {
    return "Sua ultima compra foi em {{ultima_compra}}. Temos novidades e reposicoes que combinam com quem ja compra com a Bulking.";
  }
  if (playbookId === "high-ltv-dormant") {
    return "Sentimos sua falta por aqui. Sua conta segue ativa na Bulking para voce voltar quando fizer sentido.";
  }
  return "Sua conta segue ativa na Bulking. Temos uma comunicacao rapida para te ajudar na proxima compra.";
}

function cleanScheduledAtOverride(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;

  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Horario de agendamento invalido.");
  }

  const now = Date.now();
  if (date.getTime() < now - 60_000) {
    throw new Error("Escolha um horario atual ou futuro para agendar.");
  }
  if (date.getTime() > now + 30 * DAY_MS) {
    throw new Error("Escolha um horario nos proximos 30 dias.");
  }

  return date.toISOString();
}

function brtScheduleParts(iso: string) {
  const date = new Date(iso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      weekday: "short",
      hour: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(parts.weekday));
  const hour = Number(parts.hour);
  return {
    day: day >= 0 ? day : date.getUTCDay(),
    hour: Number.isFinite(hour) ? hour : date.getUTCHours(),
  };
}

function resolveTemplateValue(value: string, contact: Contact): string {
  let missingRequiredToken = false;
  const resolveToken = (token: string) => {
    if (token === "nome") return contact.name || "cliente";
    const resolved = contact.variables?.[token] || "";
    if (!String(resolved).trim()) missingRequiredToken = true;
    return resolved;
  };
  const resolvedValue = value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, token: string) =>
    resolveToken(token)
  );
  return missingRequiredToken ? "" : resolvedValue;
}

async function inferBestSendWindow(admin: AdminClient, workspaceId: string) {
  const since = new Date(Date.now() - 90 * DAY_MS).toISOString();
  const { data } = await admin
    .from("crm_vendas")
    .select("data_compra")
    .eq("workspace_id", workspaceId)
    .gte("data_compra", since)
    .limit(5000);

  const crmBySlot = new Map<string, number>();
  for (const row of (data || []) as Array<{ data_compra: string | null }>) {
    if (!row.data_compra || !/[T\s]\d{2}:\d{2}/.test(row.data_compra)) continue;
    const date = parseDate(row.data_compra);
    if (!date) continue;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo",
        weekday: "short",
        hour: "2-digit",
        hour12: false,
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value])
    );
    const hour = Number(parts.hour);
    if (!Number.isFinite(hour) || hour < 9 || hour > 20) continue;
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(parts.weekday));
    const key = `${day >= 0 ? day : date.getDay()}:${hour}`;
    crmBySlot.set(key, (crmBySlot.get(key) || 0) + 1);
  }

  const ga4BySlot = new Map<
    string,
    { sessions: number; transactions: number; revenue: number }
  >();
  let ga4Available = false;
  if (process.env.GA4_PROPERTY_ID) {
    try {
      const ga4 = await getGA4Report({
        datePreset: "last_90d",
        dimensions: ["dayOfWeek", "hour"],
        metrics: ["sessions", "transactions", "purchaseRevenue"],
        limit: 200,
      });
      for (const row of ga4.rows || []) {
        const day = Number(row.dimensions.dayOfWeek);
        const hour = Number(row.dimensions.hour);
        if (!Number.isFinite(day) || !Number.isFinite(hour) || hour < 9 || hour > 20) continue;
        ga4BySlot.set(`${day}:${hour}`, {
          sessions: toNumber(row.metrics.sessions),
          transactions: toNumber(row.metrics.transactions),
          revenue: toNumber(row.metrics.purchaseRevenue),
        });
      }
      ga4Available = ga4BySlot.size > 0;
    } catch (err) {
      console.error("[Retention Autopilot] GA4 hour score failed:", err instanceof Error ? err.message : err);
    }
  }

  const crmMax = Math.max(1, ...crmBySlot.values());
  const ga4Rows = [...ga4BySlot.values()];
  const ga4TxMax = Math.max(1, ...ga4Rows.map((row) => row.transactions));
  const ga4RevenueMax = Math.max(1, ...ga4Rows.map((row) => row.revenue));
  const ga4SessionsMax = Math.max(1, ...ga4Rows.map((row) => row.sessions));
  const slotScore = (day: number, hour: number) => {
    const key = `${day}:${hour}`;
    const crmOrders = crmBySlot.get(key) || 0;
    const ga4 = ga4BySlot.get(key) || { sessions: 0, transactions: 0, revenue: 0 };
    return {
      crmOrders,
      ga4,
      score:
        (crmOrders / crmMax) * 45 +
        (ga4.transactions / ga4TxMax) * 35 +
        (ga4.revenue / ga4RevenueMax) * 15 +
        (ga4.sessions / ga4SessionsMax) * 5,
    };
  };

  const now = new Date();
  const brtNow = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const candidates: Array<{
    day: number;
    hour: number;
    daysAhead: number;
    scheduledAt: string;
    score: number;
    crmOrders: number;
    ga4: { sessions: number; transactions: number; revenue: number };
  }> = [];

  for (let daysAhead = 0; daysAhead < 8; daysAhead++) {
    const date = new Date(brtNow);
    date.setUTCDate(date.getUTCDate() + daysAhead);
    const day = date.getUTCDay();
    for (let hour = 9; hour <= 20; hour++) {
      const scheduledBrt = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, 0, 0, 0)
      );
      const scheduledUtc = new Date(scheduledBrt.getTime() + 3 * 60 * 60 * 1000);
      if (scheduledUtc.getTime() <= now.getTime() + 30 * 60 * 1000) continue;
      const slot = slotScore(day, hour);
      candidates.push({
        day,
        hour,
        daysAhead,
        scheduledAt: scheduledUtc.toISOString(),
        score: slot.score,
        crmOrders: slot.crmOrders,
        ga4: slot.ga4,
      });
    }
  }

  const best = candidates
    .sort((a, b) => (b.score - b.daysAhead * 7) - (a.score - a.daysAhead * 7) || a.daysAhead - b.daysAhead || a.hour - b.hour)[0];

  if (!best) {
    return {
      hour: 10,
      day: brtNow.getUTCDay(),
      scheduledAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      source: "fallback_10h",
      reason: "Sem janela valida encontrada; fallback operacional.",
    };
  }

  const source =
    ga4Available && crmBySlot.size > 0
      ? "ga4_crm_historico"
      : ga4Available
        ? "ga4_historico"
        : crmBySlot.size > 0
          ? "historico_pedidos"
          : "fallback_horario";
  const reason =
    source === "ga4_crm_historico"
      ? `Cruzou pedidos CRM e GA4: ${best.crmOrders} pedidos CRM, ${best.ga4.transactions} transacoes GA4 e ${Math.round(best.ga4.sessions)} sessoes nesse slot.`
      : source === "ga4_historico"
        ? `GA4 indicou ${best.ga4.transactions} transacoes e ${Math.round(best.ga4.sessions)} sessoes nesse slot.`
        : source === "historico_pedidos"
          ? `Historico CRM indicou ${best.crmOrders} pedidos nesse dia/hora.`
          : "Sem dados fortes; escolheu a proxima janela operacional.";

  return {
    hour: best.hour,
    day: best.day,
    scheduledAt: best.scheduledAt,
    source,
    reason,
  };
}

async function autoScheduleWhatsappRun(params: {
  admin: AdminClient;
  workspaceId: string;
  playbookId: string;
  playbookName: string;
  runId: string;
  treatmentList: Omit<ContactListRow, "contacts">;
  treatmentContacts: Contact[];
  holdoutList: Omit<ContactListRow, "contacts"> | null;
  attributionWindowDays: number;
  templateId?: string | null;
  variableValues?: Record<string, string>;
  scheduledAt?: string | null;
}) {
  let template =
    (await fetchTemplateById(params.admin, params.workspaceId, params.templateId || "")) ||
    (await pickApprovedUtilityTemplate(params.admin, params.workspaceId, params.playbookId));
  let templateCreated = false;
  if (!template) {
    const pending = await ensurePendingRetentionUtilityTemplate(params.admin, params.workspaceId);
    template = pending.template;
    templateCreated = pending.created;
    if (!template) {
      return {
        status: "needs_template" as const,
        reason:
          pending.reason ||
          "Nao encontrei template WhatsApp aprovado na categoria UTILITY compativel com este playbook de retencao.",
      };
    }
  }

  const vars = extractTemplateVariables(template.components || []);
  const defaultVariableValues = buildAutopilotVariableDefaults(params.playbookId, template, vars);
  const variableValues = cleanScheduleVariableValues(params.variableValues, vars, defaultVariableValues);
  const missingVars = vars.filter((variable) => !variableValues[variable]);
  if (missingVars.length > 0) {
    return {
      status: "needs_template_mapping" as const,
      reason: `Template aprovado, mas faltou mapear ${missingVars.join(", ")} sem risco de mensagem sem sentido.`,
      templateName: template.name,
    };
  }

  const rawContacts = buildTemplateContacts(params.treatmentContacts, vars, variableValues);

  if (rawContacts.length === 0) {
    return {
      status: "blocked" as const,
      reason: "A lista de tratamento nao tem contatos com telefone e variaveis suficientes para WhatsApp.",
      templateName: template.name,
    };
  }

  const compliance = await filterContacts(params.workspaceId, rawContacts, 7);
  if (compliance.allowed.length === 0) {
    return {
      status: "blocked" as const,
      reason: "Todos os contatos foram bloqueados por cooldown ou exclusao.",
      templateName: template.name,
      compliance: {
        originalCount: rawContacts.length,
        cooldownCount: compliance.cooldownCount,
        blockedCount: compliance.blockedCount,
      },
    };
  }

  const inferredSendWindow = await inferBestSendWindow(params.admin, params.workspaceId);
  const manualScheduledAt = cleanScheduledAtOverride(params.scheduledAt);
  const manualParts = manualScheduledAt ? brtScheduleParts(manualScheduledAt) : null;
  const sendWindow = manualScheduledAt
    ? {
        ...inferredSendWindow,
        scheduledAt: manualScheduledAt,
        day: manualParts!.day,
        hour: manualParts!.hour,
        source: "manual",
        reason: "Horario editado manualmente antes do agendamento.",
      }
    : inferredSendWindow;
  const scheduledAt = sendWindow.scheduledAt;
  const campaignName = `Auto Retencao ${params.playbookName} ${new Date().toISOString().slice(0, 10)}`;
  const templateApproved = template.status === "APPROVED" && template.category === "UTILITY";
  const campaignStatus = templateApproved ? "scheduled" : "pending_template";

  const { data: campaign, error: campaignError } = await params.admin
    .from("wa_campaigns")
    .insert({
      workspace_id: params.workspaceId,
      kind: "campaign",
      name: campaignName,
      template_id: template.id,
      template_name: template.name,
      template_language: template.language,
      segment_filter: {
        contact_list_id: params.treatmentList.id,
        contact_list_name: params.treatmentList.name,
        playbook_run_id: params.runId,
        playbook_id: params.playbookId,
        playbook_name: params.playbookName,
        playbook_audience_role: "treatment",
        holdout_contact_list_id: params.holdoutList?.id || null,
        holdout_pct: params.treatmentList.auto_segment?.holdout_pct ?? null,
        attribution_window_days: params.attributionWindowDays,
        autopilot: true,
        pending_template: !templateApproved,
        pending_template_created: templateCreated,
        template_guardrail: WHATSAPP_PLAYBOOK_CONTEXT[params.playbookId]?.guardrail || null,
        desired_send_hour: sendWindow.hour,
        recommended_send_day: sendWindow.day,
        send_hour_source: sendWindow.source,
        send_hour_reason: sendWindow.reason,
        recommendation_goal: params.treatmentList.auto_segment?.recommendation_goal || null,
      },
      variable_values: variableValues,
      status: campaignStatus,
      total_messages: compliance.allowed.length,
      attribution_window_days: params.attributionWindowDays,
      message_cost_usd: 0.0625,
      exchange_rate: 5.5,
      scheduled_at: templateApproved ? scheduledAt : null,
    })
    .select("id, name, status, scheduled_at, total_messages, template_name")
    .single();

  if (campaignError || !campaign) {
    throw new Error(`Falha ao criar campanha automatica: ${campaignError?.message}`);
  }

  const batchSize = 500;
  for (let i = 0; i < compliance.allowed.length; i += batchSize) {
    const batch = compliance.allowed.slice(i, i + batchSize).map((contact) => ({
      workspace_id: params.workspaceId,
      campaign_id: campaign.id,
      phone: contact.phone,
      contact_name: contact.name || null,
      variable_values: contact.variables || {},
      status: "queued",
    }));
    const { error } = await params.admin.from("wa_messages").insert(batch);
    if (error) {
      await params.admin.from("wa_campaigns").update({ status: "failed" }).eq("id", campaign.id);
      throw new Error(`Falha ao enfileirar mensagens automaticas: ${error.message}`);
    }
  }

  return {
    status: templateApproved ? ("scheduled" as const) : ("pending_template" as const),
    campaignId: campaign.id as string,
    campaignName: campaign.name as string,
    templateName: template.name,
    scheduledAt: templateApproved ? scheduledAt : null,
    recipients: compliance.allowed.length,
    originalContacts: rawContacts.length,
    cooldownCount: compliance.cooldownCount,
    blockedCount: compliance.blockedCount,
    sendHour: sendWindow.hour,
    sendHourSource: sendWindow.source,
    reason: templateApproved
      ? undefined
      : templateCreated
        ? "Template utilidade neutro criado e enviado para analise da Meta. Quando aprovar como UTILITY, o envio sera agendado automaticamente."
        : "Template utilidade neutro ja esta em analise na Meta. Quando aprovar como UTILITY, o envio sera agendado automaticamente.",
  };
}

export async function POST(request: NextRequest) {
  const { auth, error } = await authRoute(request);
  if (error) return error;

  try {
    const body = await request.json();
    const action = String(body.action || "");
    if (action === "preview_schedule" || action === "schedule_run") {
      const runId = cleanSourceRunId(body.runId);
      if (!runId) {
        return NextResponse.json({ error: "Run invalido para agendamento" }, { status: 400 });
      }

      const preview = await buildSchedulePreview({
        admin: auth!.admin,
        workspaceId: auth!.workspaceId,
        runId,
        templateId: typeof body.templateId === "string" ? body.templateId : undefined,
        variableValues:
          body.variableValues && typeof body.variableValues === "object" && !Array.isArray(body.variableValues)
            ? (body.variableValues as Record<string, string>)
            : undefined,
      });

      if (action === "preview_schedule") {
        return NextResponse.json({ preview });
      }

      const existingSameRun = await fetchActiveCampaignForRun(auth!.admin, auth!.workspaceId, runId);
      if (existingSameRun) {
        return NextResponse.json(
          {
            error: `Este run ja tem campanha ativa (${existingSameRun.status}).`,
            automation: {
              status: "blocked",
              reason: `Este run ja tem campanha ativa (${existingSameRun.status}).`,
              campaignId: existingSameRun.id,
              campaignName: existingSameRun.name,
              templateName: existingSameRun.template_name,
              scheduledAt: existingSameRun.scheduled_at,
              recipients: toNumber(existingSameRun.total_messages),
            },
          },
          { status: 409 }
        );
      }

      const activeForPlaybook = await fetchActiveCampaignForPlaybook(
        auth!.admin,
        auth!.workspaceId,
        preview.playbookId,
        runId
      );
      if (activeForPlaybook) {
        return NextResponse.json(
          {
            error: `Ja existe campanha ativa para ${preview.playbookName}: ${activeForPlaybook.name}.`,
            automation: {
              status: "blocked",
              reason: `Ja existe campanha ativa para ${preview.playbookName}: ${activeForPlaybook.name}.`,
              campaignId: activeForPlaybook.id,
              campaignName: activeForPlaybook.name,
              recipients: toNumber(activeForPlaybook.total_messages),
            },
          },
          { status: 409 }
        );
      }

      const run = await getRunLists(auth!.admin, auth!.workspaceId, runId);
      const automation = await autoScheduleWhatsappRun({
        admin: auth!.admin,
        workspaceId: auth!.workspaceId,
        playbookId: preview.playbookId,
        playbookName: preview.playbookName,
        runId,
        treatmentList: run.treatment,
        treatmentContacts: run.treatment.contacts || [],
        holdoutList: run.holdout,
        attributionWindowDays: playbookAttributionWindowDays(preview.playbookId),
        templateId: preview.templateId,
        variableValues: preview.variableValues,
        scheduledAt: typeof body.scheduledAt === "string" ? body.scheduledAt : null,
      });

      return NextResponse.json({ preview, automation });
    }

    const autoSchedule = body.autoSchedule === true;
    if (autoSchedule) {
      return NextResponse.json(
        { error: "Agendamento direto foi desativado. Revise a mensagem pelo preview antes de disparar." },
        { status: 400 }
      );
    }
    let playbookId = String(body.playbookId || "");
    let prebuiltAudience: AudienceContact[] | null = null;

    if (!playbookId && autoSchedule) {
      for (const candidate of ["cashback-expiring-14d", "active-cashback-balance"]) {
        const candidateAudience = await buildAudience(auth!.admin, auth!.workspaceId, candidate);
        if (candidateAudience.length > 0) {
          playbookId = candidate;
          prebuiltAudience = candidateAudience;
          break;
        }
      }
    }

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
    const recommendationGoal = cleanRecommendationGoal(
      body.recommendationGoal,
      playbookId,
      playbookName,
      now,
      attributionWindowDays
    );
    const audience = prebuiltAudience ?? (await buildAudience(auth!.admin, auth!.workspaceId, playbookId));

    if (audience.length === 0) {
      return NextResponse.json({ error: "Audiencia vazia para este playbook" }, { status: 400 });
    }

    if (autoSchedule) {
      const template = await pickApprovedUtilityTemplate(auth!.admin, auth!.workspaceId, playbookId);
      if (template) {
        const vars = extractTemplateVariables(template.components || []);
        const defaults = buildAutopilotVariableDefaults(playbookId, template, vars);
        const missingVars = vars.filter((variable) => !defaults[variable]);
        if (missingVars.length > 0) {
          return NextResponse.json(
            {
              error: `Template aprovado, mas faltou mapear ${missingVars.join(", ")} sem risco de mensagem sem sentido.`,
            },
            { status: 400 }
          );
        }
      }
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
      ...(recommendationGoal ? { recommendation_goal: recommendationGoal } : {}),
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

    const automation = autoSchedule
      ? await autoScheduleWhatsappRun({
          admin: auth!.admin,
          workspaceId: auth!.workspaceId,
          playbookId,
          playbookName,
          runId,
          treatmentList,
          treatmentContacts: treatment,
          holdoutList,
          attributionWindowDays,
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
        goal: recommendationGoal,
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
      automation,
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
      const incrementalOrders = incrementalOrdersForRun(
        treatment,
        holdout,
        treatmentMetrics.orders,
        holdoutMetrics.orders
      );
      const whatsapp = summarizeWaCampaigns(runId, waCampaigns);
      const email = summarizeEmailDispatches(treatment, emailDispatches, runId, attribution);
      const coupons = summarizeCoupons(runId, couponAudits, activeCoupons, runSales);
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
      const hasMeasurement =
        whatsapp.sent > 0 ||
        email.sent > 0 ||
        coupons.attributedRevenue > 0 ||
        cashback.treatment.uses > 0;
      const goal = treatment.auto_segment?.recommendation_goal || null;
      const goalResult = evaluateGoalResult({
        goal,
        attributionEnd: attribution.end,
        hasHoldout: Boolean(holdout),
        hasMeasurement,
        actualOrders: incrementalOrders,
        actualRevenue: incrementalRevenue,
        actualContribution: incrementalContribution,
        liftConversion,
      });

      return {
        id: runId,
        playbookId: attribution.playbookId,
        playbookName: treatment.auto_segment?.playbook_name || treatment.name,
        createdAt: treatment.created_at,
        attributionWindowDays: attribution.days,
        attributionEndsAt: attribution.end?.toISOString() || null,
        sourceRunId: treatment.auto_segment?.source_run_id || null,
        sourceDecision: treatment.auto_segment?.source_decision || null,
        goal,
        goalResult,
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
          incrementalOrders,
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
