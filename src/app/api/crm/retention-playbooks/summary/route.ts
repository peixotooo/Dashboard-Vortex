import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";

export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;
const HARD_CAP = 120000;

interface CrmOrderRow {
  cpf: string | null;
  email: string | null;
  cliente: string | null;
  telefone: string | null;
  valor: number | null;
  data_compra: string | null;
  source_order_id?: string | null;
  numero_pedido: string | null;
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

interface FinancialRow {
  monthly_fixed_costs?: number | string | null;
  tax_pct?: number | string | null;
  product_cost_pct?: number | string | null;
  other_expenses_pct?: number | string | null;
  invest_pct?: number | string | null;
  frete_pct?: number | string | null;
  desconto_pct?: number | string | null;
  annual_revenue_target?: number | string | null;
  target_profit_monthly?: number | string | null;
  safety_margin_pct?: number | string | null;
}

interface CashbackRow {
  id: string;
  email: string | null;
  telefone: string | null;
  status: string;
  valor_cashback: number | string | null;
  expira_em: string | null;
  usado_em: string | null;
}

interface SavedCampaignRow {
  spend: number | string | null;
  revenue: number | string | null;
  purchases: number | string | null;
  saved_at: string | null;
}

interface SavedAcquisitionSummary {
  campaigns: number;
  spend: number;
  revenue: number;
  purchases: number;
  cpa: number | null;
  source: "campaigns" | "creatives" | "none";
  latestSavedAt: string | null;
}

interface SegmentStats {
  customers: number;
  withPhone: number;
  withEmail: number;
  revenue: number;
  avgLtv: number;
  avgOrders: number;
}

interface PlaybookEstimate {
  expectedOrders: number;
  revenue: number;
  contribution: number;
  incentiveBudget: number;
  channelCost: number;
  conversionPct: number;
}

interface PlaybookAction {
  label: string;
  href: string;
  kind: "whatsapp" | "email" | "coupon" | "list" | "cashback" | "report";
}

interface RetentionPlaybook {
  id: string;
  name: string;
  priority: "alta" | "media" | "baixa";
  stage: string;
  audience: SegmentStats;
  offer: string;
  channels: string[];
  marginRule: string;
  measurement: string;
  why: string;
  estimate: PlaybookEstimate;
  actions: PlaybookAction[];
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

function customerKey(row: Pick<CrmOrderRow, "cpf" | "email" | "telefone">): string | null {
  const email = row.email?.trim().toLowerCase();
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

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function daysSince(date: Date | null, now: Date): number {
  if (!date) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - date.getTime()) / DAY_MS);
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function segmentStats(
  customers: CustomerAgg[],
  predicate: (customer: CustomerAgg) => boolean
): SegmentStats {
  let count = 0;
  let withPhone = 0;
  let withEmail = 0;
  let revenue = 0;
  let orders = 0;

  for (const customer of customers) {
    if (!predicate(customer)) continue;
    count += 1;
    if (customer.phone) withPhone += 1;
    if (customer.email) withEmail += 1;
    revenue += customer.totalSpent;
    orders += customer.orders;
  }

  return {
    customers: count,
    withPhone,
    withEmail,
    revenue,
    avgLtv: count > 0 ? revenue / count : 0,
    avgOrders: count > 0 ? orders / count : 0,
  };
}

function estimatePlaybook(params: {
  audience: number;
  conversionPct: number;
  avgOrderValue: number;
  contributionBeforeMarketingPct: number;
  incentivePerOrder: number;
  channelCostPerRecipient: number;
}): PlaybookEstimate {
  const expectedOrders = Math.round(params.audience * (params.conversionPct / 100));
  const revenue = expectedOrders * params.avgOrderValue;
  const incentiveBudget = expectedOrders * params.incentivePerOrder;
  const channelCost = params.audience * params.channelCostPerRecipient;
  const contribution =
    revenue * (params.contributionBeforeMarketingPct / 100) - incentiveBudget - channelCost;

  return {
    expectedOrders,
    revenue,
    contribution,
    incentiveBudget,
    channelCost,
    conversionPct: params.conversionPct,
  };
}

async function fetchCrmOrders(
  admin: NonNullable<Awaited<ReturnType<typeof authRoute>>["auth"]>["admin"],
  workspaceId: string
): Promise<CrmOrderRow[]> {
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

async function fetchActiveCashback(
  admin: NonNullable<Awaited<ReturnType<typeof authRoute>>["auth"]>["admin"],
  workspaceId: string
): Promise<CashbackRow[]> {
  const rows: CashbackRow[] = [];
  for (let from = 0; from < 20000; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("cashback_transactions")
      .select("id, email, telefone, status, valor_cashback, expira_em, usado_em")
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

async function fetchUsedCashbackLast30(
  admin: NonNullable<Awaited<ReturnType<typeof authRoute>>["auth"]>["admin"],
  workspaceId: string,
  sinceISO: string
): Promise<CashbackRow[]> {
  const rows: CashbackRow[] = [];
  for (let from = 0; from < 20000; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("cashback_transactions")
      .select("id, email, telefone, status, valor_cashback, expira_em, usado_em")
      .eq("workspace_id", workspaceId)
      .not("usado_em", "is", null)
      .gte("usado_em", sinceISO)
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const page = (data || []) as CashbackRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function safeCount(
  admin: NonNullable<Awaited<ReturnType<typeof authRoute>>["auth"]>["admin"],
  workspaceId: string,
  table: string,
  filter?: (query: any) => any
): Promise<number> {
  try {
    const base = admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);
    const query = filter ? filter(base) : base;
    const { count, error } = await query;
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

async function getSavedAcquisitionLast30(
  admin: NonNullable<Awaited<ReturnType<typeof authRoute>>["auth"]>["admin"],
  workspaceId: string,
  sinceISO: string
) {
  async function summarize(table: "saved_campaigns" | "saved_creatives", source: "campaigns" | "creatives") {
    const { data, error } = await admin
      .from(table)
      .select("spend, revenue, purchases, saved_at")
      .eq("workspace_id", workspaceId)
      .gte("saved_at", sinceISO)
      .order("saved_at", { ascending: false })
      .limit(500);

    if (error) {
      return {
        campaigns: 0,
        spend: 0,
        revenue: 0,
        purchases: 0,
        cpa: null,
        source: "none" as const,
        latestSavedAt: null,
      } satisfies SavedAcquisitionSummary;
    }

    const rows = (data || []) as SavedCampaignRow[];
    const spend = rows.reduce((sum, row) => sum + toNumber(row.spend), 0);
    const revenue = rows.reduce((sum, row) => sum + toNumber(row.revenue), 0);
    const purchases = rows.reduce((sum, row) => sum + toNumber(row.purchases), 0);

    return {
      campaigns: rows.length,
      spend,
      revenue,
      purchases,
      cpa: purchases > 0 ? spend / purchases : null,
      source: rows.length > 0 ? source : "none",
      latestSavedAt: rows[0]?.saved_at || null,
    } satisfies SavedAcquisitionSummary;
  }

  const [campaigns, creatives] = await Promise.all([
    summarize("saved_campaigns", "campaigns"),
    summarize("saved_creatives", "creatives"),
  ]);

  if (campaigns.purchases > 0 || campaigns.spend > 0) return campaigns;
  if (creatives.purchases > 0 || creatives.spend > 0) return creatives;

  const rows: SavedCampaignRow[] = [];
  const spend = rows.reduce((sum, row) => sum + toNumber(row.spend), 0);
  const revenue = rows.reduce((sum, row) => sum + toNumber(row.revenue), 0);
  const purchases = rows.reduce((sum, row) => sum + toNumber(row.purchases), 0);

  return {
    campaigns: rows.length,
    spend,
    revenue,
    purchases,
    cpa: purchases > 0 ? spend / purchases : null,
    source: "none" as const,
    latestSavedAt: null,
  } satisfies SavedAcquisitionSummary;
}

export async function GET(request: NextRequest) {
  const { auth, error } = await authRoute(request);
  if (error) return error;

  try {
    const admin = auth!.admin;
    const workspaceId = auth!.workspaceId;
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const since90 = new Date(now.getTime() - 90 * DAY_MS);
    const until14 = new Date(now.getTime() + 14 * DAY_MS);

    const [
      financialResult,
      orders,
      activeCashback,
      usedCashbackLast30,
      savedAcquisition,
      waCampaigns,
      waTemplates,
      emailDrafts,
      emailReports,
      couponPlans,
      activeCoupons,
      contactLists,
      cashbackTemplates,
    ] = await Promise.all([
      admin
        .from("workspace_financial_settings")
        .select("*")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      fetchCrmOrders(admin, workspaceId),
      fetchActiveCashback(admin, workspaceId),
      fetchUsedCashbackLast30(admin, workspaceId, since30.toISOString()),
      getSavedAcquisitionLast30(admin, workspaceId, since30.toISOString()),
      safeCount(admin, workspaceId, "wa_campaigns", (q) => q.eq("kind", "campaign")),
      safeCount(admin, workspaceId, "wa_templates"),
      safeCount(admin, workspaceId, "email_template_drafts"),
      safeCount(admin, workspaceId, "email_template_reports"),
      safeCount(admin, workspaceId, "promo_coupon_plans"),
      safeCount(admin, workspaceId, "promo_active_coupons"),
      safeCount(admin, workspaceId, "crm_contact_lists"),
      safeCount(admin, workspaceId, "cashback_reminder_templates"),
    ]);

    if (financialResult.error) throw financialResult.error;
    const financialData = (financialResult.data || {}) as FinancialRow;

    const financialSettings = {
      monthlyFixedCosts: toNumber(financialData.monthly_fixed_costs, 160000),
      taxPct: toNumber(financialData.tax_pct, 6),
      productCostPct: toNumber(financialData.product_cost_pct, 25),
      otherExpensesPct: toNumber(financialData.other_expenses_pct, 5),
      fretePct: toNumber(financialData.frete_pct, 6),
      descontoPct: toNumber(financialData.desconto_pct, 6),
      investPct: toNumber(financialData.invest_pct, 19),
      annualRevenueTarget: toNumber(financialData.annual_revenue_target, 9000000),
      targetProfitMonthly: toNumber(financialData.target_profit_monthly, 100000),
      safetyMarginPct: toNumber(financialData.safety_margin_pct, 5),
    };

    const contributionBeforeMarketingPct = Math.max(
      0,
      100 -
        financialSettings.taxPct -
        financialSettings.productCostPct -
        financialSettings.otherExpensesPct -
        financialSettings.fretePct -
        financialSettings.descontoPct
    );
    const contributionAfterMarketingPct = Math.max(
      0,
      contributionBeforeMarketingPct - financialSettings.investPct
    );

    const seenOrders = new Set<string>();
    const customers = new Map<string, CustomerAgg>();
    const totals = {
      orders: 0,
      revenue: 0,
      orders30: 0,
      revenue30: 0,
      customers30: new Set<string>(),
      orders90: 0,
      revenue90: 0,
      customers90: new Set<string>(),
    };

    for (const row of orders) {
      const key = orderKey(row);
      if (seenOrders.has(key)) continue;
      seenOrders.add(key);

      const date = parseDate(row.data_compra);
      const value = toNumber(row.valor);
      totals.orders += 1;
      totals.revenue += value;

      const cKey = customerKey(row);
      if (cKey) {
        const existing =
          customers.get(cKey) ||
          ({
            key: cKey,
            name: row.cliente?.trim() || "",
            email: row.email?.trim().toLowerCase() || "",
            phone: normalizePhone(row.telefone),
            orders: 0,
            totalSpent: 0,
            firstAt: null,
            lastAt: null,
          } satisfies CustomerAgg);

        existing.orders += 1;
        existing.totalSpent += value;
        if (row.cliente?.trim()) existing.name = row.cliente.trim();
        if (row.email?.trim()) existing.email = row.email.trim().toLowerCase();
        if (row.telefone?.trim()) existing.phone = normalizePhone(row.telefone);
        if (date) {
          if (!existing.firstAt || date < existing.firstAt) existing.firstAt = date;
          if (!existing.lastAt || date > existing.lastAt) existing.lastAt = date;
        }
        customers.set(cKey, existing);
      }

      if (date && date >= since30) {
        totals.orders30 += 1;
        totals.revenue30 += value;
        if (cKey) totals.customers30.add(cKey);
      }
      if (date && date >= since90) {
        totals.orders90 += 1;
        totals.revenue90 += value;
        if (cKey) totals.customers90.add(cKey);
      }
    }

    const customerList = [...customers.values()];
    const avgOrderValue30 = totals.orders30 > 0 ? totals.revenue30 / totals.orders30 : 0;
    const avgOrderValue90 = totals.orders90 > 0 ? totals.revenue90 / totals.orders90 : avgOrderValue30;
    const avgOrderValue = avgOrderValue30 || avgOrderValue90 || (totals.orders > 0 ? totals.revenue / totals.orders : 0);
    const avgCustomerLtv =
      customerList.length > 0
        ? customerList.reduce((sum, customer) => sum + customer.totalSpent, 0) / customerList.length
        : 0;
    const highLtvThreshold = Math.max(650, avgCustomerLtv * 0.9);

    const active30 = segmentStats(customerList, (c) => daysSince(c.lastAt, now) <= 30);
    const oneTimers31To60 = segmentStats(
      customerList,
      (c) => c.orders === 1 && daysSince(c.lastAt, now) >= 31 && daysSince(c.lastAt, now) <= 60
    );
    const oneTimers61To90 = segmentStats(
      customerList,
      (c) => c.orders === 1 && daysSince(c.lastAt, now) >= 61 && daysSince(c.lastAt, now) <= 90
    );
    const repeat61To180 = segmentStats(
      customerList,
      (c) => c.orders >= 2 && daysSince(c.lastAt, now) >= 61 && daysSince(c.lastAt, now) <= 180
    );
    const dormantHighLtv = segmentStats(
      customerList,
      (c) => c.orders >= 2 && c.totalSpent >= highLtvThreshold && daysSince(c.lastAt, now) > 180
    );

    const cashbackActiveTotal = activeCashback.reduce(
      (sum, row) => sum + toNumber(row.valor_cashback),
      0
    );
    const cashbackExpiring14 = activeCashback.filter((row) => {
      const expira = parseDate(row.expira_em);
      return expira ? expira <= until14 : false;
    });
    const cashbackExpiring14Total = cashbackExpiring14.reduce(
      (sum, row) => sum + toNumber(row.valor_cashback),
      0
    );
    const cashbackActiveCustomers = new Set(
      activeCashback
        .map((row) => row.email?.trim().toLowerCase() || normalizePhone(row.telefone))
        .filter(Boolean)
    );
    const cashbackExpiringCustomers = new Set(
      cashbackExpiring14
        .map((row) => row.email?.trim().toLowerCase() || normalizePhone(row.telefone))
        .filter(Boolean)
    );
    const cashbackUsed30Total = usedCashbackLast30.reduce(
      (sum, row) => sum + toNumber(row.valor_cashback),
      0
    );

    const waCostPerRecipient = 0.0625 * 5.5;
    const firstOrderContribution = avgOrderValue * (contributionBeforeMarketingPct / 100);
    const conservativeIncentiveCap = Math.max(0, firstOrderContribution * 0.35);
    const targetMonthlyRevenue =
      contributionAfterMarketingPct > 0
        ? (financialSettings.monthlyFixedCosts + financialSettings.targetProfitMonthly) /
          (contributionAfterMarketingPct / 100)
        : 0;
    const revenueGap30 = Math.max(0, targetMonthlyRevenue - totals.revenue30);
    const orderGap30 = avgOrderValue > 0 ? Math.ceil(revenueGap30 / avgOrderValue) : 0;

    const expiringCashbackStats: SegmentStats = {
      customers: cashbackExpiringCustomers.size || cashbackExpiring14.length,
      withPhone: cashbackExpiring14.filter((row) => normalizePhone(row.telefone)).length,
      withEmail: cashbackExpiring14.filter((row) => row.email?.trim()).length,
      revenue: 0,
      avgLtv: 0,
      avgOrders: 0,
    };
    const activeCashbackStats: SegmentStats = {
      customers: cashbackActiveCustomers.size || activeCashback.length,
      withPhone: activeCashback.filter((row) => normalizePhone(row.telefone)).length,
      withEmail: activeCashback.filter((row) => row.email?.trim()).length,
      revenue: 0,
      avgLtv: 0,
      avgOrders: 0,
    };

    const avgActiveCashback =
      activeCashback.length > 0 ? cashbackActiveTotal / activeCashback.length : 0;
    const avgExpiringCashback =
      cashbackExpiring14.length > 0 ? cashbackExpiring14Total / cashbackExpiring14.length : avgActiveCashback;

    const playbooks: RetentionPlaybook[] = [
      {
        id: "cashback-expiring-14d",
        name: "Saldo expirando",
        priority: "alta",
        stage: "retencao imediata",
        audience: expiringCashbackStats,
        offer: "Sem desconto novo; usar saldo ja emitido",
        channels: ["WhatsApp", "Email", "Cashback"],
        marginRule: `Nao adicionar cupom enquanto houver saldo ativo. Teto medio ja emitido: R$ ${avgExpiringCashback.toFixed(2)}.`,
        measurement: "Holdout 10%, janela 7 dias, margem incremental por cliente acionado.",
        why: "Transforma passivo de cashback em recompra antes de expirar, com custo de midia baixo.",
        estimate: estimatePlaybook({
          audience: expiringCashbackStats.customers,
          conversionPct: 8,
          avgOrderValue,
          contributionBeforeMarketingPct,
          incentivePerOrder: avgExpiringCashback,
          channelCostPerRecipient: waCostPerRecipient,
        }),
        actions: [
          { label: "Cashback", href: "/crm/cashback", kind: "cashback" },
          { label: "WhatsApp", href: "/crm/whatsapp", kind: "whatsapp" },
          { label: "Email", href: "/crm/email-templates", kind: "email" },
          { label: "Relatorio", href: "/crm", kind: "report" },
        ],
      },
      {
        id: "active-cashback-balance",
        name: "Saldo ativo sem uso",
        priority: "alta",
        stage: "recompra com incentivo existente",
        audience: activeCashbackStats,
        offer: "Personalizar pelo valor de saldo disponivel",
        channels: ["Cashback", "WhatsApp"],
        marginRule: `Priorizar itens de margem saudavel. Evitar cupom extra acima de ${pct(financialSettings.safetyMarginPct)}.`,
        measurement: "Comparar uso de saldo vs grupo nao acionado por 14 dias.",
        why: "A base ja tem motivo para voltar; o trabalho e reduzir esquecimento e friccao.",
        estimate: estimatePlaybook({
          audience: activeCashbackStats.customers,
          conversionPct: 5,
          avgOrderValue,
          contributionBeforeMarketingPct,
          incentivePerOrder: avgActiveCashback,
          channelCostPerRecipient: waCostPerRecipient,
        }),
        actions: [
          { label: "Cashback", href: "/crm/cashback", kind: "cashback" },
          { label: "WhatsApp", href: "/crm/whatsapp", kind: "whatsapp" },
          { label: "Lista", href: "/crm/listas", kind: "list" },
        ],
      },
      {
        id: "second-purchase-31-60d",
        name: "Segunda compra 31-60d",
        priority: "alta",
        stage: "ativacao de recorrencia",
        audience: oneTimers31To60,
        offer: `Cupom teto R$ ${Math.min(avgOrderValue * 0.1, conservativeIncentiveCap).toFixed(2)} ou cashback dirigido`,
        channels: ["WhatsApp", "Email", "Cupom VNDA"],
        marginRule: `Incentivo maximo sugerido: ${pct(Math.min(10, (conservativeIncentiveCap / Math.max(avgOrderValue, 1)) * 100))} do pedido medio.`,
        measurement: "Holdout 10%, janela 14 dias, segunda compra incremental.",
        why: "Grandes ecommerces tratam a segunda compra como o principal evento de retencao.",
        estimate: estimatePlaybook({
          audience: oneTimers31To60.customers,
          conversionPct: 4,
          avgOrderValue,
          contributionBeforeMarketingPct,
          incentivePerOrder: Math.min(avgOrderValue * 0.1, conservativeIncentiveCap),
          channelCostPerRecipient: waCostPerRecipient,
        }),
        actions: [
          { label: "Lista", href: "/crm/listas", kind: "list" },
          { label: "Cupom", href: "/coupons", kind: "coupon" },
          { label: "WhatsApp", href: "/crm/whatsapp", kind: "whatsapp" },
          { label: "Email", href: "/crm/email-templates", kind: "email" },
        ],
      },
      {
        id: "one-time-61-90d-save",
        name: "Primeira compra esfriando",
        priority: "media",
        stage: "prevencao de churn",
        audience: oneTimers61To90,
        offer: "Oferta progressiva: conteudo/produto primeiro, cupom so no segundo toque",
        channels: ["Email", "WhatsApp"],
        marginRule: `Comecar sem desconto; se usar cupom, manter abaixo de R$ ${Math.min(avgOrderValue * 0.12, conservativeIncentiveCap).toFixed(2)}.`,
        measurement: "Medir recompra em 21 dias e comparar desconto vs sem desconto.",
        why: "Evita que clientes de uma compra virem base perdida antes de ficarem caros de reativar.",
        estimate: estimatePlaybook({
          audience: oneTimers61To90.customers,
          conversionPct: 2.8,
          avgOrderValue,
          contributionBeforeMarketingPct,
          incentivePerOrder: Math.min(avgOrderValue * 0.08, conservativeIncentiveCap),
          channelCostPerRecipient: waCostPerRecipient,
        }),
        actions: [
          { label: "Email", href: "/crm/email-templates", kind: "email" },
          { label: "WhatsApp", href: "/crm/whatsapp", kind: "whatsapp" },
          { label: "Relatorio", href: "/crm", kind: "report" },
        ],
      },
      {
        id: "repeat-61-180d",
        name: "Recompra de clientes recorrentes",
        priority: "media",
        stage: "retencao de valor",
        audience: repeat61To180,
        offer: "Acesso antecipado, kit ou cupom seletivo por margem",
        channels: ["WhatsApp", "Email", "Cupom VNDA"],
        marginRule: `Liberar incentivo apenas se margem esperada ficar acima de ${pct(contributionAfterMarketingPct)} pos-midia.`,
        measurement: "Incremental lift por ticket e frequencia, nao so receita atribuida.",
        why: "Clientes recorrentes respondem melhor a novidade, exclusividade e reposicao do que desconto aberto.",
        estimate: estimatePlaybook({
          audience: repeat61To180.customers,
          conversionPct: 3.5,
          avgOrderValue,
          contributionBeforeMarketingPct,
          incentivePerOrder: Math.min(avgOrderValue * 0.12, firstOrderContribution * 0.4),
          channelCostPerRecipient: waCostPerRecipient,
        }),
        actions: [
          { label: "Lista", href: "/crm/listas", kind: "list" },
          { label: "Cupom", href: "/coupons", kind: "coupon" },
          { label: "WhatsApp", href: "/crm/whatsapp", kind: "whatsapp" },
        ],
      },
      {
        id: "high-ltv-dormant",
        name: "Dormantes de alto LTV",
        priority: "media",
        stage: "winback seletivo",
        audience: dormantHighLtv,
        offer: "Oferta forte, limitada e segmentada por historico de compra",
        channels: ["WhatsApp", "Email", "Cupom VNDA"],
        marginRule: `So entrar com cupom alto se LTV historico >= R$ ${highLtvThreshold.toFixed(0)}.`,
        measurement: "Janela 21 dias, holdout 15%, margem por reativado.",
        why: "Reativacao de massa costuma queimar margem; o recorte por LTV preserva contribuicao.",
        estimate: estimatePlaybook({
          audience: dormantHighLtv.customers,
          conversionPct: 1.8,
          avgOrderValue,
          contributionBeforeMarketingPct,
          incentivePerOrder: Math.min(avgOrderValue * 0.15, firstOrderContribution * 0.45),
          channelCostPerRecipient: waCostPerRecipient,
        }),
        actions: [
          { label: "Lista", href: "/crm/listas", kind: "list" },
          { label: "Cupom", href: "/coupons", kind: "coupon" },
          { label: "WhatsApp", href: "/crm/whatsapp", kind: "whatsapp" },
          { label: "Email", href: "/crm/email-templates", kind: "email" },
        ],
      },
    ];
    playbooks.sort((a, b) => b.estimate.contribution - a.estimate.contribution);

    return NextResponse.json(
      {
        generatedAt: now.toISOString(),
        dataQuality: {
          crmOrdersLoaded: orders.length,
          uniqueOrders: totals.orders,
          uniqueCustomers: customerList.length,
          savedCampaignsAreCpaProxy: true,
          acquisitionProxySource: savedAcquisition.source,
          abcMarginNeedsValidation: true,
        },
        financial: {
          settings: financialSettings,
          contributionBeforeMarketingPct,
          contributionAfterMarketingPct,
          avgOrderValue,
          firstOrderContribution,
          plannedMarketingPerOrder: avgOrderValue * (financialSettings.investPct / 100),
          targetMonthlyRevenue,
          revenueGap30,
          orderGap30,
        },
        crm: {
          lifetime: {
            orders: totals.orders,
            customers: customerList.length,
            revenue: totals.revenue,
            avgOrderValue: totals.orders > 0 ? totals.revenue / totals.orders : 0,
          },
          last30: {
            orders: totals.orders30,
            customers: totals.customers30.size,
            revenue: totals.revenue30,
            avgOrderValue: avgOrderValue30,
          },
          last90: {
            orders: totals.orders90,
            customers: totals.customers90.size,
            revenue: totals.revenue90,
            avgOrderValue: avgOrderValue90,
          },
          segments: {
            active30,
            oneTimers31To60,
            oneTimers61To90,
            repeat61To180,
            dormantHighLtv,
          },
        },
        acquisition: savedAcquisition,
        cashback: {
          activeTransactions: activeCashback.length,
          activeCustomers: cashbackActiveCustomers.size,
          activeValue: cashbackActiveTotal,
          avgActiveValue: avgActiveCashback,
          expiring14Transactions: cashbackExpiring14.length,
          expiring14Customers: cashbackExpiringCustomers.size,
          expiring14Value: cashbackExpiring14Total,
          used30Transactions: usedCashbackLast30.length,
          used30Value: cashbackUsed30Total,
        },
        capabilities: {
          waCampaigns,
          waTemplates,
          emailDrafts,
          emailReports,
          couponPlans,
          activeCoupons,
          contactLists,
          cashbackTemplates,
        },
        measurement: {
          holdoutPctDefault: 10,
          attributionWindowDays: 14,
          primaryMetric: "margem incremental",
          requiredIds: [
            "playbook_run_id",
            "wa_campaign_id",
            "email_draft_id",
            "coupon_code",
            "cashback_transaction_id",
          ],
        },
        playbooks,
      },
      { headers: { "Cache-Control": "private, max-age=120" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Retention Playbooks] summary error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
