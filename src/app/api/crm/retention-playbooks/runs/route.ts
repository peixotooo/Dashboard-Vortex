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

function withParams(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params);
  return `${path}?${qs.toString()}`;
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
  return {
    listReady: Boolean(list.locaweb_list_id),
    locawebListId: list.locaweb_list_id,
    emailContacts: list.email_count,
    sourceListId: list.id,
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
    const runId = randomUUID();
    const now = new Date();
    const playbookName = PLAYBOOK_LABELS[playbookId];
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
      created_at: now.toISOString(),
    };

    const treatmentList = await createList({
      admin: auth!.admin,
      workspaceId: auth!.workspaceId,
      userId: auth!.userId,
      name: `Playbook ${playbookName} ${dateLabel} Tratamento`,
      description: `Tratamento do playbook ${playbookName}. Run ${runId}.`,
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
            description: `Grupo de controle do playbook ${playbookName}. Nao disparar campanha. Run ${runId}.`,
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
        holdoutPct,
        audienceCount: audience.length,
        treatmentList,
        holdoutList,
        links: {
          whatsapp: withParams("/crm/whatsapp", {
            list: treatmentList.id,
            name: `Playbook ${playbookName} ${dateLabel}`,
          }),
          lists: withParams("/crm/listas", { list: treatmentList.id }),
          email: withParams("/crm/listas", { email: treatmentList.id }),
          coupons: withParams("/coupons", {
            playbook: playbookId,
            run: runId,
            name: `Cupom ${playbookName} ${dateLabel}`,
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
    const [sales, marginPct, waCampaigns] = await Promise.all([
      fetchSalesSince(auth!.admin, auth!.workspaceId, since),
      contributionMarginPct(auth!.admin, auth!.workspaceId),
      fetchWaCampaignsSince(auth!.admin, auth!.workspaceId, since, runIds),
    ]);

    const runs = groups.map(([runId, group]) => {
      const treatment = group.treatment!;
      const holdout = group.holdout;
      const runSales = sales.filter((sale) => {
        const saleDate = parseDate(sale.data_compra);
        const start = parseDate(treatment.created_at);
        return saleDate && start && saleDate >= start;
      });
      const treatmentMetrics = summarizeSalesForList(treatment, runSales, marginPct);
      const holdoutMetrics = summarizeSalesForList(holdout, runSales, marginPct);
      const liftConversion = treatmentMetrics.conversionRate - holdoutMetrics.conversionRate;
      const liftRevenuePerContact =
        treatmentMetrics.revenuePerContact - holdoutMetrics.revenuePerContact;
      const incrementalRevenue = Math.max(0, liftRevenuePerContact * treatment.total_count);
      const whatsapp = summarizeWaCampaigns(runId, waCampaigns);
      const email = summarizeEmailChannel(treatment);
      const incrementalContribution =
        incrementalRevenue * (marginPct / 100) - whatsapp.costBrl;

      return {
        id: runId,
        playbookId: treatment.auto_segment?.playbook_id,
        playbookName: treatment.auto_segment?.playbook_name || treatment.name,
        createdAt: treatment.created_at,
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
        },
        channels: {
          whatsapp,
          email,
        },
        links: {
          whatsapp: withParams("/crm/whatsapp", {
            list: treatment.id,
            name: `Playbook ${treatment.auto_segment?.playbook_name || "Retencao"}`,
          }),
          lists: withParams("/crm/listas", { list: treatment.id }),
          email: withParams("/crm/listas", { email: treatment.id }),
          coupons: withParams("/coupons", {
            playbook: String(treatment.auto_segment?.playbook_id || ""),
            run: runId,
            name: `Cupom ${treatment.auto_segment?.playbook_name || "Retencao"}`,
          }),
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
