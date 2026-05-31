"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Coins,
  Gauge,
  Gem,
  ListChecks,
  Loader2,
  Mail,
  MessageCircle,
  Percent,
  RefreshCw,
  ShieldCheck,
  Tag,
  Target,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/lib/workspace-context";

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
  retentionCostPerOrder: number;
  cpaDelta: number | null;
  cpaEfficiency: number | null;
  conversionPct: number;
  grossContributionPerOrder: number;
  netContributionPerOrder: number;
  breakEvenOrders: number;
  breakEvenConversionPct: number;
}

interface PlaybookAction {
  label: string;
  href: string;
  kind: "whatsapp" | "email" | "coupon" | "list" | "cashback" | "report";
}

interface IncentiveGuardrail {
  mode: "cashback_only" | "no_discount_first" | "coupon_allowed" | "selective_coupon";
  label: string;
  discountMinPct: number;
  discountMaxPct: number;
  durationHours: number;
  maxActiveProducts: number;
  requireManualApproval: boolean;
  target: "tier_b" | "tier_c" | "low_cvr_high_views" | "manual";
  discountUnit: "pct" | "brl" | "auto";
  reason: string;
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
  holdoutPct: number;
  attributionWindowDays: number;
  why: string;
  incentiveGuardrail: IncentiveGuardrail;
  estimate: PlaybookEstimate;
  actions: PlaybookAction[];
}

interface SummaryResponse {
  generatedAt: string;
  dataQuality: {
    crmOrdersLoaded: number;
    uniqueOrders: number;
    uniqueCustomers: number;
    savedCampaignsAreCpaProxy: boolean;
    acquisitionProxySource?: "campaigns" | "creatives" | "none";
    abcMarginNeedsValidation: boolean;
  };
  financial: {
    settings: {
      monthlyFixedCosts: number;
      taxPct: number;
      productCostPct: number;
      otherExpensesPct: number;
      investPct: number;
      fretePct: number;
      descontoPct: number;
      annualRevenueTarget: number;
      targetProfitMonthly: number;
      safetyMarginPct: number;
    };
    contributionBeforeMarketingPct: number;
    contributionAfterMarketingPct: number;
    avgOrderValue: number;
    firstOrderContribution: number;
    plannedMarketingPerOrder: number;
    targetMonthlyRevenue: number;
    revenueGap30: number;
    orderGap30: number;
  };
  crm: {
    lifetime: { orders: number; customers: number; revenue: number; avgOrderValue: number };
    last30: { orders: number; customers: number; revenue: number; avgOrderValue: number };
    last90: { orders: number; customers: number; revenue: number; avgOrderValue: number };
    segments: Record<string, SegmentStats>;
  };
  acquisition: {
    campaigns: number;
    spend: number;
    revenue: number;
    purchases: number;
    cpa: number | null;
    source?: "campaigns" | "creatives" | "none";
    latestSavedAt?: string | null;
  };
  cashback: {
    activeTransactions: number;
    activeCustomers: number;
    activeValue: number;
    avgActiveValue: number;
    expiring14Transactions: number;
    expiring14Customers: number;
    expiring14Value: number;
    used30Transactions: number;
    used30Value: number;
    config?: {
      percentage: number;
      depositDelayDays: number;
      validityDays: number;
      reminder1Day: number;
      reminder2Day: number;
      reminder3Day: number;
      reactivationDays: number;
      reactivationReminderDay: number;
      whatsappMinValue: number;
      emailMinValue: number;
      channelMode: string;
    };
  };
  capabilities: {
    waCampaigns: number;
    waTemplates: number;
    emailDrafts: number;
    emailReports: number;
    couponPlans: number;
    activeCoupons: number;
    contactLists: number;
    cashbackTemplates: number;
  };
  measurement: {
    holdoutPctDefault: number;
    attributionWindowDays: number;
    primaryMetric: string;
    requiredIds: string[];
  };
  playbooks: RetentionPlaybook[];
}

interface PreparedRun {
  id: string;
  playbookId: string;
  playbookName: string;
  createdAt: string;
  sourceRunId?: string | null;
  sourceDecision?: string | null;
  holdoutPct: number;
  audienceCount: number;
  treatmentList: {
    id: string;
    name: string;
    total_count: number;
    phone_count: number;
    email_count: number;
    locaweb_list_id?: string | null;
  };
  holdoutList: {
    id: string;
    name: string;
    total_count: number;
    phone_count: number;
    email_count: number;
    locaweb_list_id?: string | null;
  } | null;
  links: {
    whatsapp: string;
    lists: string;
    email: string;
    coupons: string;
  };
}

interface WhatsAppRunSummary {
  campaignCount: number;
  totalMessages: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  costBrl: number;
  statuses: Record<string, number>;
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    totalMessages: number;
    sent: number;
    costBrl: number;
    createdAt: string;
  }>;
}

interface EmailRunSummary {
  listReady: boolean;
  locawebListId: string | null;
  emailContacts: number;
  sourceListId: string;
  dispatchCount: number;
  sent: number;
  failed: number;
  opens: number;
  clicks: number;
  statuses: Record<string, number>;
  dispatches: Array<{
    id: string;
    subject: string | null;
    status: string;
    provider: string;
    sent: number;
    failed: number;
    createdAt: string;
  }>;
}

interface CouponRunSummary {
  planCount: number;
  couponCount: number;
  attributedRevenue: number;
  attributedUnits: number;
  attributedDiscount: number;
  statuses: Record<string, number>;
  coupons: Array<{
    id: string;
    code: string;
    status: string;
    discountPct: number;
    attributedRevenue: number;
    attributedUnits: number;
    attributedDiscount: number;
    expiresAt: string;
  }>;
}

interface CashbackMetricSummary {
  users: number;
  uses: number;
  cashbackValue: number;
  orderValue: number;
  usageRate: number;
  valuePerContact: number;
}

interface CashbackRunSummary {
  treatment: CashbackMetricSummary;
  holdout: CashbackMetricSummary;
  liftUsageRate: number;
  incrementalCashbackValue: number;
  incrementalOrderValue: number;
}

interface RunReport {
  id: string;
  playbookId?: string;
  playbookName: string;
  createdAt: string;
  attributionWindowDays?: number;
  attributionEndsAt?: string | null;
  sourceRunId?: string | null;
  sourceDecision?: string | null;
  treatmentList: {
    id: string;
    name: string;
    totalCount: number;
    phoneCount: number;
    emailCount: number;
    locawebListId: string | null;
  };
  holdoutList: {
    id: string;
    name: string;
    totalCount: number;
    phoneCount: number;
    emailCount: number;
    locawebListId: string | null;
  } | null;
  metrics: {
    treatment: {
      buyers: number;
      orders: number;
      revenue: number;
      conversionRate: number;
      revenuePerContact: number;
      contribution: number;
    };
    holdout: {
      buyers: number;
      orders: number;
      revenue: number;
      conversionRate: number;
      revenuePerContact: number;
      contribution: number;
    };
    liftConversion: number;
    incrementalRevenue: number;
    incrementalContribution: number;
    trackedChannelCost: number;
    trackedCashbackCost?: number;
    trackedOfferCost?: number;
    trackedTotalCost?: number;
  };
  channels?: {
    whatsapp?: WhatsAppRunSummary;
    email?: EmailRunSummary;
    coupons?: CouponRunSummary;
    cashback?: CashbackRunSummary;
  };
  links: {
    whatsapp: string;
    lists: string;
    email: string;
    coupons: string;
  };
}

const BRL = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const NUMBER = (value: number) => value.toLocaleString("pt-BR");

const PCT = (value: number) => `${value.toFixed(1)}%`;
const RATE = (value: number) => `${(value * 100).toFixed(1)}%`;

function priorityVariant(priority: RetentionPlaybook["priority"]): "default" | "secondary" | "outline" {
  if (priority === "alta") return "default";
  if (priority === "media") return "secondary";
  return "outline";
}

function actionIcon(kind: PlaybookAction["kind"]) {
  if (kind === "whatsapp") return <MessageCircle className="h-3.5 w-3.5" />;
  if (kind === "email") return <Mail className="h-3.5 w-3.5" />;
  if (kind === "coupon") return <Tag className="h-3.5 w-3.5" />;
  if (kind === "list") return <ListChecks className="h-3.5 w-3.5" />;
  if (kind === "cashback") return <Coins className="h-3.5 w-3.5" />;
  return <BarChart3 className="h-3.5 w-3.5" />;
}

const WA_STATUS_LABELS: Record<string, string> = {
  draft: "rascunho",
  pending: "pendente",
  scheduled: "agendada",
  sending: "enviando",
  completed: "concluida",
  failed: "falhou",
  canceled: "cancelada",
  cancelled: "cancelada",
  paused: "pausada",
};

function waStatusLabel(status: string) {
  return WA_STATUS_LABELS[status.toLowerCase()] || status;
}

function waStatusSummary(statuses: Record<string, number> | undefined) {
  const entries = Object.entries(statuses || {}).filter(([, count]) => count > 0);
  if (entries.length === 0) return "sem campanha";
  return entries.map(([status, count]) => `${NUMBER(count)} ${waStatusLabel(status)}`).join(" · ");
}

const COUPON_STATUS_LABELS: Record<string, string> = {
  pending: "pendente",
  active: "ativo",
  paused: "pausado",
  expired: "expirado",
  cancelled: "cancelado",
  failed: "falhou",
};

function compactStatusSummary(
  statuses: Record<string, number> | undefined,
  labels: Record<string, string> = {}
) {
  const entries = Object.entries(statuses || {}).filter(([, count]) => count > 0);
  if (entries.length === 0) return "sem registro";
  return entries.map(([status, count]) => `${NUMBER(count)} ${labels[status] || status}`).join(" · ");
}

type CouponRequirement = "required" | "optional" | "none";

const REQUIRED_COUPON_PLAYBOOKS = new Set([
  "second-purchase-31-60d",
  "repeat-61-180d",
  "high-ltv-dormant",
]);
const OPTIONAL_COUPON_PLAYBOOKS = new Set(["one-time-61-90d-save"]);

function runCouponRequirement(run: Pick<RunReport, "playbookId" | "playbookName">): CouponRequirement {
  if (run.playbookId && REQUIRED_COUPON_PLAYBOOKS.has(run.playbookId)) return "required";
  if (run.playbookId && OPTIONAL_COUPON_PLAYBOOKS.has(run.playbookId)) return "optional";
  if (/cashback|saldo/i.test(run.playbookName)) return "none";
  if (/cupom|segunda|recorrentes|dormantes|winback/i.test(run.playbookName)) return "required";
  return "optional";
}

function couponStatusCount(coupons: CouponRunSummary | undefined, status: string) {
  return coupons?.statuses?.[status] ?? 0;
}

function preparedRunActionPlan(run: PreparedRun) {
  const couponRequirement = runCouponRequirement(run);
  const hasPhone = run.treatmentList.phone_count > 0;
  const hasEmail = run.treatmentList.email_count > 0;
  const whatsappAction = {
    key: "whatsapp",
    href: run.links.whatsapp,
    label: "Criar WhatsApp",
    icon: <MessageCircle className="mr-2 h-4 w-4" />,
  };
  const emailAction = {
    key: "email",
    href: run.links.email,
    label: "Email",
    icon: <Mail className="mr-2 h-4 w-4" />,
  };
  const couponAction = {
    key: "coupon",
    href: run.links.coupons,
    label: couponRequirement === "optional" ? "Cupom opcional" : "Criar cupom",
    icon: <Tag className="mr-2 h-4 w-4" />,
  };
  const listAction = {
    key: "lists",
    href: run.links.lists,
    label: "Listas",
    icon: <ListChecks className="mr-2 h-4 w-4" />,
  };
  const channelActions = [hasPhone ? whatsappAction : null, hasEmail ? emailAction : null].filter(
    (action): action is typeof whatsappAction | typeof emailAction => Boolean(action)
  );

  if (couponRequirement === "required") {
    return {
      hint: "Proximo passo: criar/rodar o cupom VNDA antes de disparar a mensagem.",
      actions: [couponAction, ...channelActions, listAction],
    };
  }

  if (couponRequirement === "none") {
    return {
      hint: "Proximo passo: comunicar saldo/cashback existente sem criar desconto novo.",
      actions: [...channelActions, listAction],
    };
  }

  return {
    hint: "Proximo passo: comecar pelo canal; cupom fica como segundo toque se precisar.",
    actions: [...channelActions, couponAction, listAction],
  };
}

type RunProgressStep = { label: string; done: boolean };

function getRunExecutionState(run: RunReport) {
  const whatsapp = run.channels?.whatsapp;
  const email = run.channels?.email;
  const coupons = run.channels?.coupons;
  const cashback = run.channels?.cashback;
  const hasHoldout = (run.holdoutList?.totalCount ?? 0) > 0;
  const whatsappCreated = (whatsapp?.campaignCount ?? 0) > 0;
  const whatsappSent = (whatsapp?.sent ?? 0) > 0;
  const emailReady = Boolean(email?.listReady);
  const emailDispatchCreated = (email?.dispatchCount ?? 0) > 0;
  const emailSent = (email?.sent ?? 0) > 0;
  const couponRequirement = runCouponRequirement(run);
  const needsCoupon = couponRequirement === "required";
  const couponPlanReady = (coupons?.planCount ?? 0) > 0;
  const couponGenerated = (coupons?.couponCount ?? 0) > 0;
  const pendingCoupons = couponStatusCount(coupons, "pending");
  const activeCoupons = couponStatusCount(coupons, "active");
  const couponReady = couponGenerated;
  const hasCashbackUsage = (cashback?.treatment.uses ?? 0) > 0 || (cashback?.holdout.uses ?? 0) > 0;
  const outboundPrepared = whatsappCreated || emailDispatchCreated || emailReady;
  const outboundSent = whatsappSent || emailSent;
  const outboundReady = outboundSent;
  const measurementReady = hasHoldout && (outboundSent || couponReady || hasCashbackUsage);
  const progressSteps: RunProgressStep[] = [
    { label: "holdout", done: hasHoldout },
    ...(needsCoupon ? [{ label: "cupom", done: couponReady }] : []),
    { label: "canal", done: outboundReady },
    { label: "medicao", done: measurementReady },
  ];
  const doneSteps = progressSteps.filter((step) => step.done).length;
  const missingSteps = progressSteps.filter((step) => !step.done).map((step) => step.label);
  const progressPct = Math.round((doneSteps / Math.max(1, progressSteps.length)) * 100);

  return {
    hasHoldout,
    whatsappCreated,
    whatsappReady: whatsappSent,
    whatsappSent,
    emailReady,
    emailDispatchCreated,
    emailSent,
    couponRequirement,
    needsCoupon,
    couponPlanReady,
    couponGenerated,
    pendingCoupons,
    activeCoupons,
    couponReady,
    hasCashbackUsage,
    outboundPrepared,
    outboundSent,
    outboundReady,
    measurementReady,
    progressSteps,
    doneSteps,
    missingSteps,
    progressPct,
  };
}

function emailTemplatesHref(run: RunReport) {
  const listId = run.channels?.email?.locawebListId || run.treatmentList.locawebListId;
  if (!listId) return "/crm/email-templates";

  const params = new URLSearchParams({
    list: listId,
    audience: run.treatmentList.name,
    run: run.id,
    playbook: run.playbookName,
  });
  if (run.playbookId) params.set("playbook_id", run.playbookId);
  return `/crm/email-templates?${params.toString()}`;
}

function getRunNextAction(run: RunReport) {
  const whatsapp = run.channels?.whatsapp;
  const email = run.channels?.email;
  const coupons = run.channels?.coupons;
  const whatsappCreated = (whatsapp?.campaignCount ?? 0) > 0;
  const whatsappSent = (whatsapp?.sent ?? 0) > 0;
  const emailReady = Boolean(email?.listReady);
  const emailDispatchCreated = (email?.dispatchCount ?? 0) > 0;
  const emailSent = (email?.sent ?? 0) > 0;
  const couponRequirement = runCouponRequirement(run);
  const needsCoupon = couponRequirement === "required";
  const couponPlanReady = (coupons?.planCount ?? 0) > 0;
  const couponGenerated = (coupons?.couponCount ?? 0) > 0;
  const pendingCoupons = couponStatusCount(coupons, "pending");
  const activeCoupons = couponStatusCount(coupons, "active");

  if (needsCoupon && !couponPlanReady) {
    return {
      label: "Criar cupom VNDA",
      href: run.links.coupons,
      hint: "Primeiro prepare a oferta que vai entrar na mensagem.",
      icon: <Tag className="h-3.5 w-3.5" />,
    };
  }

  if (needsCoupon && couponPlanReady && !couponGenerated) {
    return {
      label: "Rodar cupom VNDA",
      href: run.links.coupons,
      hint: "O plano ja existe; rode agora para gerar sugestoes de cupons desse run.",
      icon: <Tag className="h-3.5 w-3.5" />,
    };
  }

  if (needsCoupon && pendingCoupons > 0 && activeCoupons === 0) {
    return {
      label: "Aprovar cupons",
      href: run.links.coupons,
      hint: "Aprove ao menos um cupom antes de usar a oferta na mensagem.",
      icon: <Tag className="h-3.5 w-3.5" />,
    };
  }

  if (!whatsappCreated && run.treatmentList.phoneCount > 0) {
    return {
      label: "Criar WhatsApp",
      href: run.links.whatsapp,
      hint: "Use a lista de tratamento ja ligada ao holdout.",
      icon: <MessageCircle className="h-3.5 w-3.5" />,
    };
  }

  if (whatsappCreated && !whatsappSent && run.treatmentList.phoneCount > 0) {
    return {
      label: "Enviar WhatsApp",
      href: "/crm/whatsapp",
      hint: "Campanha criada, mas ainda sem envios. Ative ou aguarde o envio para entrar na medicao.",
      icon: <MessageCircle className="h-3.5 w-3.5" />,
    };
  }

  if (!emailReady && run.treatmentList.emailCount > 0) {
    return {
      label: "Promover lista",
      href: run.links.email,
      hint: "Crie a lista Locaweb antes do disparo de email.",
      icon: <Mail className="h-3.5 w-3.5" />,
    };
  }

  if (emailReady && !emailDispatchCreated) {
    return {
      label: "Criar email",
      href: emailTemplatesHref(run),
      hint: "A lista ja esta pronta para ser usada no disparo.",
      icon: <Mail className="h-3.5 w-3.5" />,
    };
  }

  if (emailDispatchCreated && !emailSent) {
    return {
      label: "Acompanhar email",
      href: "/crm/email-templates/reports",
      hint: "Email criado, mas ainda sem enviados contabilizados para este run.",
      icon: <Mail className="h-3.5 w-3.5" />,
    };
  }

  return {
    label: "Acompanhar resultado",
    href: "/crm/retention",
    hint: "Canais principais enviados; acompanhe lift, receita e contribuicao.",
    icon: <BarChart3 className="h-3.5 w-3.5" />,
  };
}

type ExecutionStepState = "ready" | "prepared" | "todo" | "optional";

const EXECUTION_STATE_LABELS: Record<ExecutionStepState, string> = {
  ready: "pronto",
  prepared: "preparado",
  todo: "fazer",
  optional: "opcional",
};

function ExecutionStep({
  icon,
  label,
  state,
  hint,
  href,
  actionLabel,
}: {
  icon: React.ReactNode;
  label: string;
  state: ExecutionStepState;
  hint: string;
  href?: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex min-h-[132px] flex-col justify-between rounded-md border bg-background p-3">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="text-muted-foreground">{icon}</span>
            {label}
          </div>
          <Badge variant={state === "ready" ? "secondary" : "outline"}>
            {EXECUTION_STATE_LABELS[state]}
          </Badge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      </div>
      {href && actionLabel && (
        <Button asChild size="sm" variant={state === "todo" ? "default" : "outline"} className="mt-3 w-full">
          <Link href={href}>{actionLabel}</Link>
        </Button>
      )}
    </div>
  );
}

function trackingStateVariant(state: ExecutionStepState): "default" | "secondary" | "outline" {
  if (state === "ready") return "secondary";
  if (state === "prepared") return "outline";
  if (state === "todo") return "default";
  return "outline";
}

function getRunTrackingContract(run: RunReport, attributionWindowDays: number) {
  const state = getRunExecutionState(run);
  const whatsapp = run.channels?.whatsapp;
  const email = run.channels?.email;
  const coupons = run.channels?.coupons;
  const cashback = run.channels?.cashback;
  const ageDays = daysFrom(run.createdAt);
  const windowDays = Math.max(1, attributionWindowDays);
  const hasWhatsapp = (whatsapp?.campaignCount ?? 0) > 0;
  const hasEmailDispatch = (email?.dispatchCount ?? 0) > 0;
  const channelValue = state.whatsappSent
    ? `${NUMBER(whatsapp?.sent ?? 0)} envios WA`
    : hasWhatsapp
      ? `${NUMBER(whatsapp?.campaignCount ?? 0)} WA criado`
      : state.emailSent
      ? `${NUMBER(email?.sent ?? 0)} emails`
      : hasEmailDispatch
      ? `${NUMBER(email?.dispatchCount ?? 0)} email criado`
      : state.emailReady
        ? "email pronto"
        : "pendente";
  const offerValue = state.needsCoupon
    ? state.couponReady
      ? `${NUMBER(coupons?.couponCount ?? 0)} cupons`
      : state.couponPlanReady
        ? "plano criado"
        : "cupom pendente"
    : state.hasCashbackUsage
      ? `${NUMBER(cashback?.treatment.uses ?? 0)} usos`
      : state.couponRequirement === "none"
        ? "sem cupom"
        : state.couponReady
          ? `${NUMBER(coupons?.couponCount ?? 0)} cupons`
          : "opcional";

  return [
    {
      label: "Run ID",
      value: run.id.slice(0, 8),
      state: "ready" as const,
      hint: "base de atribuicao",
    },
    {
      label: "Holdout",
      value: NUMBER(run.holdoutList?.totalCount ?? 0),
      state: state.hasHoldout ? ("ready" as const) : ("todo" as const),
      hint: state.hasHoldout ? "controle isolado" : "sem controle",
    },
    {
      label: "Canal",
      value: channelValue,
      state: state.outboundSent ? ("ready" as const) : state.outboundPrepared ? ("prepared" as const) : ("todo" as const),
      hint: state.outboundSent ? "envio registrado" : state.outboundPrepared ? "falta envio" : "faltando disparo",
    },
    {
      label: "Incentivo",
      value: offerValue,
      state:
        state.needsCoupon && !state.couponReady
          ? ("todo" as const)
          : state.couponReady
            ? ("ready" as const)
            : ("optional" as const),
      hint: state.needsCoupon
        ? "custo rastreavel"
        : state.couponRequirement === "none"
          ? "cashback/saldo"
          : "segundo toque",
    },
    {
      label: "Janela",
      value: `${NUMBER(ageDays)}/${NUMBER(windowDays)}d`,
      state: ageDays >= windowDays ? ("ready" as const) : ("optional" as const),
      hint: ageDays >= windowDays ? "decisao liberada" : "em coleta",
    },
  ];
}

function RunTrackingContract({
  run,
  attributionWindowDays,
}: {
  run: RunReport;
  attributionWindowDays: number;
}) {
  const items = getRunTrackingContract(run, attributionWindowDays);
  const missing = items
    .filter((item) => item.state === "todo" || item.state === "prepared")
    .map((item) => item.label.toLowerCase());

  return (
    <div className="mt-3 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Contrato de medicao</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Receita, margem, custo e lift usam estes vinculos para fechar o resultado.
          </p>
        </div>
        <Badge variant={missing.length === 0 ? "secondary" : "outline"}>
          {missing.length === 0 ? "rastreavel" : `falta ${missing.join(", ")}`}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {items.map((item) => (
          <div key={item.label} className="rounded-md bg-muted/35 p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <Badge variant={trackingStateVariant(item.state)}>{EXECUTION_STATE_LABELS[item.state]}</Badge>
            </div>
            <p className="mt-1 truncate text-sm font-semibold">{item.value}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{item.hint}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RunExecutionChecklist({
  run,
  attributionWindowDays,
}: {
  run: RunReport;
  attributionWindowDays: number;
}) {
  const whatsapp = run.channels?.whatsapp;
  const email = run.channels?.email;
  const coupons = run.channels?.coupons;
  const state = getRunExecutionState(run);
  const couponActionLabel = state.couponGenerated
    ? state.pendingCoupons > 0
      ? "Aprovar"
      : "Abrir"
    : state.couponPlanReady
      ? "Rodar"
      : state.needsCoupon
        ? "Criar"
        : "Avaliar";
  const nextAction = getRunNextAction(run);

  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Esteira da execucao</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Lista, canais e holdout precisam ficar ligados ao mesmo run.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={state.measurementReady ? "secondary" : "outline"}>
            {state.measurementReady ? "medindo" : `${state.doneSteps}/${state.progressSteps.length} pronto`}
          </Badge>
          <Button asChild size="sm">
            <Link href={nextAction.href}>
              {nextAction.icon}
              <span className="ml-1.5">{nextAction.label}</span>
              <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
      <div className="mt-2 space-y-1.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${state.progressPct}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          Proximo clique: {nextAction.hint}
          {state.missingSteps.length > 0 ? ` Falta: ${state.missingSteps.join(", ")}.` : ""}
        </p>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-5">
        <ExecutionStep
          icon={<ListChecks className="h-3.5 w-3.5" />}
          label="Audiencia"
          state="ready"
          hint={`${NUMBER(run.treatmentList.totalCount)} tratamento · ${NUMBER(run.holdoutList?.totalCount ?? 0)} holdout`}
          href={run.links.lists}
          actionLabel="Abrir lista"
        />
        <ExecutionStep
          icon={<MessageCircle className="h-3.5 w-3.5" />}
          label="WhatsApp"
          state={state.whatsappSent ? "ready" : state.whatsappCreated ? "prepared" : "todo"}
          hint={
            state.whatsappSent
              ? `${NUMBER(whatsapp?.sent ?? 0)} envios vinculados`
              : state.whatsappCreated
              ? "Campanha criada; falta envio"
              : `${NUMBER(run.treatmentList.phoneCount)} contatos com telefone`
          }
          href={run.links.whatsapp}
          actionLabel={state.whatsappCreated ? "Abrir" : "Criar"}
        />
        <ExecutionStep
          icon={<Mail className="h-3.5 w-3.5" />}
          label="Email"
          state={state.emailSent ? "ready" : state.emailReady || state.emailDispatchCreated ? "prepared" : "todo"}
          hint={
            state.emailSent
              ? `${NUMBER(email?.sent ?? 0)} enviados vinculados`
              : state.emailDispatchCreated
              ? `${NUMBER(email?.dispatchCount ?? 0)} disparos criados; falta envio`
              : state.emailReady
              ? `Lista Locaweb pronta`
              : `${NUMBER(email?.emailContacts ?? run.treatmentList.emailCount)} contatos com email`
          }
          href={state.emailReady ? emailTemplatesHref(run) : run.links.email}
          actionLabel={state.emailReady ? (state.emailSent ? "Ver" : "Criar") : "Promover"}
        />
        <ExecutionStep
          icon={<Tag className="h-3.5 w-3.5" />}
          label="Cupom"
          state={state.couponReady ? "ready" : state.needsCoupon ? "todo" : "optional"}
          hint={
            state.couponReady
              ? `${NUMBER(coupons?.couponCount ?? 0)} cupons · ${BRL(coupons?.attributedRevenue ?? 0)} atribuido`
              : state.couponPlanReady
              ? "Plano criado; rode para gerar os cupons"
              : state.needsCoupon
              ? "Oferta precisa de plano VNDA"
              : state.couponRequirement === "none"
              ? "Sem desconto novo como padrao"
              : "Cupom opcional no segundo toque"
          }
          href={run.links.coupons}
          actionLabel={couponActionLabel}
        />
        <ExecutionStep
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          label="Medicao"
          state={state.measurementReady ? "ready" : state.hasHoldout ? "optional" : "todo"}
          hint={
            state.measurementReady
              ? `Holdout ${NUMBER(run.holdoutList?.totalCount ?? 0)} com envio/custo vinculado`
              : state.hasHoldout && state.outboundPrepared
              ? `Holdout ${NUMBER(run.holdoutList?.totalCount ?? 0)} ativo; falta envio`
              : state.hasHoldout
              ? `Holdout ${NUMBER(run.holdoutList?.totalCount ?? 0)} ativo; falta canal enviado`
              : "Sem grupo de controle"
          }
        />
      </div>
      <RunTrackingContract run={run} attributionWindowDays={attributionWindowDays} />
    </div>
  );
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type RunDecisionTone = "setup" | "wait" | "scale" | "pause" | "watch";

interface RunDecision {
  tone: RunDecisionTone;
  label: string;
  title: string;
  detail: string;
  ctaLabel: string;
  href: string;
  ageDays: number;
  roi: number | null;
  windowProgressPct: number;
}

function decisionVariant(tone: RunDecisionTone): "default" | "secondary" | "outline" {
  if (tone === "scale") return "default";
  if (tone === "setup" || tone === "pause") return "secondary";
  return "outline";
}

function daysFrom(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / MS_PER_DAY));
}

function playbookAttributionWindowDays(playbook: RetentionPlaybook | undefined, fallback: number) {
  return Math.max(1, playbook?.attributionWindowDays ?? fallback);
}

function getRunDecision(run: RunReport, attributionWindowDays: number): RunDecision {
  const state = getRunExecutionState(run);
  const nextAction = getRunNextAction(run);
  const ageDays = daysFrom(run.createdAt);
  const windowDays = Math.max(1, attributionWindowDays);
  const windowProgressPct = Math.min(100, Math.round((ageDays / windowDays) * 100));
  const totalCost = run.metrics.trackedTotalCost ?? run.metrics.trackedChannelCost ?? 0;
  const roi = totalCost > 0 ? run.metrics.incrementalContribution / totalCost : null;
  const hasAnyResult =
    run.metrics.treatment.orders > 0 ||
    run.metrics.holdout.orders > 0 ||
    run.metrics.incrementalRevenue > 0 ||
    state.hasCashbackUsage;

  if (!state.measurementReady) {
    return {
      tone: "setup",
      label: "configurar",
      title: "Ainda nao da para ler o resultado",
      detail: `Falta ${state.missingSteps.join(", ") || "vincular canal/custo"} para esse run virar relatorio confiavel.`,
      ctaLabel: nextAction.label,
      href: nextAction.href,
      ageDays,
      roi,
      windowProgressPct,
    };
  }

  if (!hasAnyResult && ageDays < windowDays) {
    return {
      tone: "wait",
      label: "aguardar",
      title: "Run medindo, mas ainda sem sinal suficiente",
      detail: `Janela em ${ageDays}/${windowDays} dias. Evite concluir cedo antes de leitura de lift e margem.`,
      ctaLabel: "Acompanhar",
      href: "/crm/retention",
      ageDays,
      roi,
      windowProgressPct,
    };
  }

  if (run.metrics.incrementalContribution > 0 && run.metrics.liftConversion > 0) {
    return {
      tone: "scale",
      label: "escalar",
      title: "Lift positivo com margem incremental",
      detail: "Pode repetir para uma nova safra ou ampliar canal mantendo holdout e o mesmo controle de incentivo.",
      ctaLabel: nextAction.label === "Acompanhar resultado" ? "Novo canal" : nextAction.label,
      href: nextAction.label === "Acompanhar resultado" ? run.links.whatsapp : nextAction.href,
      ageDays,
      roi,
      windowProgressPct,
    };
  }

  if (ageDays >= windowDays && run.metrics.incrementalContribution <= 0) {
    return {
      tone: "pause",
      label: "pausar",
      title: "Nao escalar sem aprender",
      detail: "A janela ja rodou e a contribuicao incremental nao pagou custo/oferta. Revise publico, oferta e canal.",
      ctaLabel: "Ver detalhes",
      href: "/crm/retention",
      ageDays,
      roi,
      windowProgressPct,
    };
  }

  return {
    tone: "watch",
    label: "monitorar",
    title: "Resultado em formacao",
    detail: "Mantenha o run isolado ate a janela fechar. A decisao vem de margem incremental, nao de receita bruta.",
    ctaLabel: "Acompanhar",
    href: "/crm/retention",
    ageDays,
    roi,
    windowProgressPct,
  };
}

function RunDecisionPanel({
  run,
  decision,
  scalePlaybook,
  scaleDisabled,
  scaleLoading,
  onScale,
}: {
  run: RunReport;
  decision: RunDecision;
  scalePlaybook?: RetentionPlaybook;
  scaleDisabled?: boolean;
  scaleLoading?: boolean;
  onScale?: (playbook: RetentionPlaybook, sourceRun: RunReport, sourceDecision: RunDecision) => void;
}) {
  const canScale = decision.tone === "scale" && Boolean(scalePlaybook && onScale);

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Decisao do run</p>
            <Badge variant={decisionVariant(decision.tone)}>{decision.label}</Badge>
          </div>
          <p className="mt-1 text-sm font-medium">{decision.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{decision.detail}</p>
        </div>
        {canScale ? (
          <Button
            size="sm"
            onClick={() => scalePlaybook && onScale?.(scalePlaybook, run, decision)}
            disabled={scaleDisabled || scaleLoading}
          >
            {scaleLoading ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ListChecks className="mr-2 h-3.5 w-3.5" />
            )}
            Nova safra
          </Button>
        ) : (
          <Button asChild size="sm" variant={decision.tone === "setup" ? "default" : "outline"}>
            <Link href={decision.href}>
              {decision.ctaLabel}
              <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        )}
      </div>

      <div className="mt-3 grid gap-3 text-sm md:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Janela</p>
          <p className="font-semibold">{NUMBER(decision.ageDays)}d</p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${decision.windowProgressPct}%` }}
            />
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Lift conv.</p>
          <p className="font-semibold">{RATE(run.metrics.liftConversion)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">MC liquida</p>
          <p className="font-semibold">{BRL(run.metrics.incrementalContribution)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">ROI custo</p>
          <p className="font-semibold">{decision.roi == null ? "sem custo" : `${decision.roi.toFixed(1)}x`}</p>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-bold">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          </div>
          <div className="rounded-md bg-muted p-2 text-muted-foreground">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

type ReadinessStatus = "ready" | "attention" | "todo";

const READINESS_LABELS: Record<ReadinessStatus, string> = {
  ready: "pronto",
  attention: "revisar",
  todo: "fazer",
};

function readinessVariant(status: ReadinessStatus): "default" | "secondary" | "outline" {
  if (status === "ready") return "default";
  if (status === "attention") return "secondary";
  return "outline";
}

function acquisitionSourceLabel(source?: "campaigns" | "creatives" | "none") {
  if (source === "campaigns") return "campanhas salvas";
  if (source === "creatives") return "criativos salvos";
  return "sem proxy recente";
}

function guardrailSummary(guardrail: IncentiveGuardrail) {
  if (guardrail.discountMaxPct <= 0) return "Sem cupom novo";
  return `${guardrail.discountMinPct}-${guardrail.discountMaxPct}% · ${guardrail.durationHours}h · ${NUMBER(guardrail.maxActiveProducts)} ativos`;
}

function cpaEfficiencyText(estimate: PlaybookEstimate) {
  if (estimate.cpaDelta == null || estimate.cpaEfficiency == null) return "sem CPA salvo";
  if (estimate.cpaDelta >= 0) {
    return `${estimate.cpaEfficiency.toFixed(1)}x menor que CPA`;
  }
  return `${BRL(Math.abs(estimate.cpaDelta))} acima do CPA`;
}

function ReadinessItem({
  icon,
  title,
  status,
  value,
  detail,
  href,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  status: ReadinessStatus;
  value: string;
  detail: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="flex min-h-[156px] flex-col justify-between rounded-md border bg-background p-3">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="text-muted-foreground">{icon}</span>
            {title}
          </div>
          <Badge variant={readinessVariant(status)}>{READINESS_LABELS[status]}</Badge>
        </div>
        <p className="mt-3 text-lg font-semibold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </div>
      <Button asChild size="sm" variant={status === "todo" ? "default" : "outline"} className="mt-3 w-full">
        <Link href={href}>
          {cta}
          <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
        </Link>
      </Button>
    </div>
  );
}

function ReadinessPanel({ data, runs }: { data: SummaryResponse; runs: RunReport[] }) {
  const runsWithHoldout = runs.filter((run) => (run.holdoutList?.totalCount ?? 0) > 0).length;
  const measuredRuns = runs.filter((run) => getRunExecutionState(run).measurementReady).length;
  const measurementStatus: ReadinessStatus =
    measuredRuns > 0 ? "ready" : runsWithHoldout > 0 ? "attention" : "todo";
  const cpaSource = data.acquisition.source ?? data.dataQuality.acquisitionProxySource ?? "none";
  const hasCpa = data.acquisition.cpa != null && data.acquisition.purchases > 0;

  const items = [
    {
      icon: <WalletCards className="h-3.5 w-3.5" />,
      title: "CAC/CPA",
      status: hasCpa ? "ready" : "attention",
      value: hasCpa ? BRL(data.acquisition.cpa ?? 0) : "Sem CPA fresco",
      detail: hasCpa
        ? `${NUMBER(data.acquisition.purchases)} compras via ${acquisitionSourceLabel(cpaSource)} nos ultimos 30 dias.`
        : "Atualize Meta/salve campanhas para comparar aquisicao com margem.",
      href: "/campaigns",
      cta: hasCpa ? "Ver campanhas" : "Atualizar origem",
    },
    {
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
      title: "Margem",
      status: data.financial.contributionAfterMarketingPct > 0 ? "ready" : "attention",
      value: PCT(data.financial.contributionAfterMarketingPct),
      detail: `${PCT(data.financial.contributionBeforeMarketingPct)} antes de midia; teto bruto por pedido ${BRL(data.financial.firstOrderContribution)}.`,
      href: "/financeiro",
      cta: "Ver financeiro",
    },
    {
      icon: <Coins className="h-3.5 w-3.5" />,
      title: "Cashback",
      status: data.capabilities.cashbackTemplates > 0 && data.cashback.activeValue > 0 ? "ready" : "attention",
      value: BRL(data.cashback.activeValue),
      detail: `${NUMBER(data.cashback.activeCustomers)} clientes com saldo; ${BRL(data.cashback.expiring14Value)} expira em 14 dias.`,
      href: "/crm/cashback",
      cta: "Abrir cashback",
    },
    {
      icon: <MessageCircle className="h-3.5 w-3.5" />,
      title: "WhatsApp",
      status: data.capabilities.waTemplates > 0 ? "ready" : "todo",
      value: `${NUMBER(data.capabilities.waTemplates)} templates`,
      detail: `${NUMBER(data.capabilities.waCampaigns)} campanhas criadas. Use sempre lista de tratamento, nunca holdout.`,
      href: "/crm/whatsapp",
      cta: "Criar WhatsApp",
    },
    {
      icon: <Mail className="h-3.5 w-3.5" />,
      title: "Email",
      status: data.capabilities.emailDrafts > 0 ? "ready" : "todo",
      value: `${NUMBER(data.capabilities.emailDrafts)} rascunhos`,
      detail: `${NUMBER(data.capabilities.emailReports)} relatorios. O criador com IA ja recebe contexto do playbook.`,
      href: "/crm/email-templates",
      cta: "Criar email",
    },
    {
      icon: <Tag className="h-3.5 w-3.5" />,
      title: "Cupom VNDA",
      status: data.capabilities.couponPlans > 0 || data.capabilities.activeCoupons > 0 ? "ready" : "attention",
      value: `${NUMBER(data.capabilities.activeCoupons)} ativos`,
      detail: `${NUMBER(data.capabilities.couponPlans)} planos. Use cupom so quando cashback/novidade nao bastar.`,
      href: "/coupons",
      cta: "Ver cupons",
    },
    {
      icon: <BarChart3 className="h-3.5 w-3.5" />,
      title: "Mensuracao",
      status: measurementStatus,
      value: `${NUMBER(measuredRuns)}/${NUMBER(runs.length)} medindo`,
      detail: `${NUMBER(runsWithHoldout)} com holdout. KPI principal: ${data.measurement.primaryMetric}.`,
      href: "/crm/retention",
      cta: measurementStatus === "todo" ? "Preparar run" : "Ver resultados",
    },
  ] satisfies Array<{
    icon: React.ReactNode;
    title: string;
    status: ReadinessStatus;
    value: string;
    detail: string;
    href: string;
    cta: string;
  }>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Painel de implantacao</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              O que ja esta pronto e o que ainda trava executar com poucos cliques.
            </p>
          </div>
          <Badge variant="outline">{NUMBER(items.filter((item) => item.status === "ready").length)} prontos</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {items.map((item) => (
            <ReadinessItem key={item.title} {...item} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function positiveSum(values: number[]) {
  return values.reduce((sum, value) => sum + Math.max(0, value), 0);
}

function channelModeLabel(mode?: string) {
  if (mode === "whatsapp_only") return "So WhatsApp";
  if (mode === "email_only") return "So email";
  if (mode === "custom") return "Por estagio";
  return "WhatsApp + email";
}

function StrategyPill({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-lg font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function StrategyBoard({
  data,
  preparingId,
  onPrepare,
}: {
  data: SummaryResponse;
  preparingId: string | null;
  onPrepare: (playbook: RetentionPlaybook) => void;
}) {
  const byId = useMemo(() => {
    const map = new Map<string, RetentionPlaybook>();
    for (const playbook of data.playbooks) map.set(playbook.id, playbook);
    return map;
  }, [data.playbooks]);

  const totalEstimatedOrders = data.playbooks.reduce(
    (sum, playbook) => sum + Math.max(0, playbook.estimate.expectedOrders),
    0
  );
  const totalEstimatedRevenue = positiveSum(data.playbooks.map((playbook) => playbook.estimate.revenue));
  const totalEstimatedContribution = positiveSum(
    data.playbooks.map((playbook) => playbook.estimate.contribution)
  );
  const gapCoverage =
    data.financial.revenueGap30 > 0 ? totalEstimatedRevenue / data.financial.revenueGap30 : 0;
  const cpaShare =
    data.acquisition.cpa != null && data.financial.firstOrderContribution > 0
      ? data.acquisition.cpa / data.financial.firstOrderContribution
      : null;
  const cashbackUseShare =
    data.cashback.activeValue + data.cashback.used30Value > 0
      ? data.cashback.used30Value / (data.cashback.activeValue + data.cashback.used30Value)
      : 0;
  const expiringShare =
    data.cashback.activeValue > 0 ? data.cashback.expiring14Value / data.cashback.activeValue : 0;
  const cfg = data.cashback.config;
  const bestPlaybook = data.playbooks[0];

  const lanes: Array<{
    title: string;
    icon: React.ReactNode;
    signal: string;
    rule: string;
    playbookId: string;
    cadence: string;
  }> = [
    {
      title: "Cashback primeiro",
      icon: <Coins className="h-4 w-4" />,
      signal: `${NUMBER(data.cashback.activeCustomers)} clientes com ${BRL(data.cashback.activeValue)} ativo`,
      rule: "Nao empilhar cupom. O saldo ja e incentivo; use mensagem, urgencia e produto certo.",
      playbookId: "cashback-expiring-14d",
      cadence: `Todo dia: saldos a vencer; D+${cfg?.reminder3Day ?? 29}: véspera de expiracao.`,
    },
    {
      title: "Segunda compra",
      icon: <Target className="h-4 w-4" />,
      signal: `${NUMBER(data.crm.segments.oneTimers31To60?.customers ?? 0)} clientes entre 31-60d`,
      rule: "Tratar como ativacao, nao liquidacao. Cupom leve so onde a margem permite.",
      playbookId: "second-purchase-31-60d",
      cadence: "2x por semana, sempre com holdout e janela de 14 dias.",
    },
    {
      title: "Recorrentes/VIP",
      icon: <Gem className="h-4 w-4" />,
      signal: `${NUMBER(data.crm.segments.repeat61To180?.customers ?? 0)} recorrentes frios`,
      rule: "Grandes ecommerces vendem novidade, acesso e reposicao antes de desconto.",
      playbookId: "repeat-61-180d",
      cadence: "Rodar junto de drop, restock, kit ou produto de margem saudavel.",
    },
    {
      title: "Winback seletivo",
      icon: <ShieldCheck className="h-4 w-4" />,
      signal: `${NUMBER(data.crm.segments.dormantHighLtv?.customers ?? 0)} dormantes de alto LTV`,
      rule: "Nao reativar massa com desconto aberto. Oferta forte somente para alto LTV.",
      playbookId: "high-ltv-dormant",
      cadence: "1x por mes, janela 21 dias e holdout maior para validar margem.",
    },
  ];

  return (
    <section className="rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Estrategia recomendada</h2>
            <Badge variant="outline">Revenue first</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Usar retencao para comprar recompra barata antes de aumentar CAC. O desconto entra so quando o
            lift paga a margem.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/crm/cashback">
            <Coins className="mr-2 h-3.5 w-3.5" />
            Ver regua de cashback
          </Link>
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <StrategyPill
          icon={<WalletCards className="h-3.5 w-3.5" />}
          label="CAC/CPA salvo"
          value={data.acquisition.cpa == null ? "Sem dado" : BRL(data.acquisition.cpa)}
          hint={
            cpaShare == null
              ? "Salve campanhas para comparar aquisicao vs recompra."
              : `${RATE(cpaShare)} da contribuicao bruta por pedido.`
          }
        />
        <StrategyPill
          icon={<Gauge className="h-3.5 w-3.5" />}
          label="Custo/recompra"
          value={bestPlaybook ? BRL(bestPlaybook.estimate.retentionCostPerOrder) : BRL(0)}
          hint={
            bestPlaybook
              ? `${bestPlaybook.name}: ${cpaEfficiencyText(bestPlaybook.estimate)}.`
              : "Sem fila acionavel."
          }
        />
        <StrategyPill
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
          label="Teto por pedido"
          value={BRL(data.financial.firstOrderContribution)}
          hint={`${PCT(data.financial.contributionBeforeMarketingPct)} antes de midia; ${BRL(data.financial.plannedMarketingPerOrder)} ja iria para ads.`}
        />
        <StrategyPill
          icon={<Coins className="h-3.5 w-3.5" />}
          label="Cashback a capturar"
          value={BRL(data.cashback.expiring14Value)}
          hint={`${RATE(expiringShare)} da carteira ativa expira em 14 dias; uso 30d ${RATE(cashbackUseShare)}.`}
        />
        <StrategyPill
          icon={<Gauge className="h-3.5 w-3.5" />}
          label="Fila completa"
          value={BRL(totalEstimatedContribution)}
          hint={`${NUMBER(totalEstimatedOrders)} pedidos estimados; cobre ${RATE(Math.min(gapCoverage, 1))} do gap bruto. MC liquida por pedido: ${BRL(bestPlaybook?.estimate.netContributionPerOrder ?? 0)}.`}
        />
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-md border bg-background p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Matriz de decisao</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ordem pratica para gerar volume sem treinar a base a esperar desconto.
              </p>
            </div>
            <Badge variant="secondary">{NUMBER(data.playbooks.length)} playbooks</Badge>
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {lanes.map((lane) => {
              const playbook = byId.get(lane.playbookId);
              const disabled = !playbook || playbook.audience.customers === 0 || preparingId !== null;
              return (
                <div key={lane.title} className="rounded-md bg-muted/35 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <span className="text-muted-foreground">{lane.icon}</span>
                      {lane.title}
                    </div>
                    {playbook && <Badge variant={priorityVariant(playbook.priority)}>{playbook.priority}</Badge>}
                  </div>
                  <p className="mt-2 text-xs font-medium">{lane.signal}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{lane.rule}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    <CalendarDays className="mr-1 inline h-3 w-3" />
                    {lane.cadence}
                  </p>
                  <Button
                    size="sm"
                    variant={lane.playbookId === "cashback-expiring-14d" ? "default" : "outline"}
                    className="mt-3 w-full"
                    disabled={disabled}
                    onClick={() => playbook && onPrepare(playbook)}
                  >
                    {preparingId === lane.playbookId ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ListChecks className="mr-2 h-3.5 w-3.5" />
                    )}
                    Preparar run
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-md border bg-background p-3">
          <p className="text-sm font-semibold">Regua de cashback atual</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Considerada na estrategia para nao duplicar incentivo com cupom.
          </p>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/35 px-3 py-2">
              <span className="text-muted-foreground">Cashback</span>
              <span className="font-semibold">{PCT(cfg?.percentage ?? 10)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/35 px-3 py-2">
              <span className="text-muted-foreground">Deposito</span>
              <span className="font-semibold">D+{cfg?.depositDelayDays ?? 15}</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/35 px-3 py-2">
              <span className="text-muted-foreground">Validade</span>
              <span className="font-semibold">{NUMBER(cfg?.validityDays ?? 30)} dias</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/35 px-3 py-2">
              <span className="text-muted-foreground">Lembretes</span>
              <span className="font-semibold">
                D+{cfg?.reminder1Day ?? 15} · D+{cfg?.reminder2Day ?? 25} · D+{cfg?.reminder3Day ?? 29}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/35 px-3 py-2">
              <span className="text-muted-foreground">Canal</span>
              <span className="font-semibold">{channelModeLabel(cfg?.channelMode)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/35 px-3 py-2">
              <span className="text-muted-foreground">Templates</span>
              <span className="font-semibold">{NUMBER(data.capabilities.cashbackTemplates)}</span>
            </div>
          </div>
          <div className="mt-3 rounded-md bg-primary/5 p-3 text-xs text-muted-foreground">
            <Percent className="mr-1 inline h-3.5 w-3.5" />
            Regra: cashback compra lembranca e urgencia; cupom compra indecisao. Se os dois aparecem juntos,
            a margem fica confusa e a leitura do holdout piora.
          </div>
        </div>
      </div>
    </section>
  );
}

export default function RetentionPlaybooksPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? "";
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [runs, setRuns] = useState<RunReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [preparedRun, setPreparedRun] = useState<PreparedRun | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    if (!workspaceId) return;
    const res = await fetch("/api/crm/retention-playbooks/runs", {
      headers: { "x-workspace-id": workspaceId },
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "Erro ao carregar execucoes");
    setRuns(payload.runs || []);
  }, [workspaceId]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const [summaryRes, runsRes] = await Promise.all([
        fetch("/api/crm/retention-playbooks/summary", {
          headers: { "x-workspace-id": workspaceId },
        }),
        fetch("/api/crm/retention-playbooks/runs", {
          headers: { "x-workspace-id": workspaceId },
        }),
      ]);
      const summaryPayload = await summaryRes.json();
      const runsPayload = await runsRes.json();
      if (!summaryRes.ok) throw new Error(summaryPayload.error || "Erro ao carregar playbooks");
      if (!runsRes.ok) throw new Error(runsPayload.error || "Erro ao carregar execucoes");
      setData(summaryPayload);
      setRuns(runsPayload.runs || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro de rede");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const topPlaybook = useMemo(() => data?.playbooks?.[0] ?? null, [data]);
  const nextRunAction = useMemo(() => {
    for (const run of runs) {
      const action = getRunNextAction(run);
      if (action.label !== "Acompanhar resultado") {
        return { run, action };
      }
    }
    return null;
  }, [runs]);
  const nextScaleAction = useMemo(() => {
    if (!data) return null;
    for (const run of runs) {
      const playbook = data.playbooks.find((candidate) => candidate.id === run.playbookId);
      const decision = getRunDecision(
        run,
        playbookAttributionWindowDays(playbook, data.measurement.attributionWindowDays)
      );
      if (decision.tone !== "scale") continue;
      if (playbook && playbook.audience.customers > 0) return { run, decision, playbook };
    }
    return null;
  }, [data, runs]);
  const preparedRunPlan = useMemo(
    () => (preparedRun ? preparedRunActionPlan(preparedRun) : null),
    [preparedRun]
  );

  async function preparePlaybook(
    playbook: RetentionPlaybook,
    source?: { runId?: string | null; decision?: RunDecision["tone"] | null }
  ) {
    if (!workspaceId) return;
    setPreparingId(playbook.id);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/crm/retention-playbooks/runs", {
        method: "POST",
        headers: {
          "x-workspace-id": workspaceId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          playbookId: playbook.id,
          holdoutPct: playbook.holdoutPct ?? data?.measurement.holdoutPctDefault ?? 10,
          ...(source?.runId
            ? {
                sourceRunId: source.runId,
                sourceDecision: source.decision || "scale",
              }
            : {}),
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Erro ao preparar execucao");
      setPreparedRun(payload.run);
      await fetchRuns();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro de rede");
    } finally {
      setPreparingId(null);
    }
  }

  if (!workspaceId) {
    return (
      <div className="max-w-6xl space-y-4">
        <h1 className="text-2xl font-bold">Playbooks de Retencao</h1>
        <p className="text-sm text-muted-foreground">Selecione um workspace.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <TrendingUp className="h-6 w-6" />
            Playbooks de Retencao
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Prioridade por margem, CAC/CPA, cashback e base acionavel.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <span>{errorMsg}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Carregando playbooks...
        </div>
      ) : data ? (
        <>
          {preparedRun && (
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div>
                  <p className="text-sm font-semibold">Execucao preparada: {preparedRun.playbookName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Tratamento com {NUMBER(preparedRun.treatmentList.total_count)} contatos
                    {preparedRun.holdoutList
                      ? ` e holdout com ${NUMBER(preparedRun.holdoutList.total_count)} contatos.`
                      : "."}
                    {preparedRun.sourceRunId ? ` Origem: run ${preparedRun.sourceRunId.slice(0, 8)}.` : ""}
                  </p>
                  {preparedRunPlan && (
                    <p className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      {preparedRunPlan.hint}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(preparedRunPlan?.actions ?? []).map((action, index) => (
                    <Button key={action.key} asChild variant={index === 0 ? "default" : "outline"} size="sm">
                      <Link href={action.href}>
                        {action.icon}
                        {action.label}
                      </Link>
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div>
                <p className="text-sm font-semibold">Proximo clique recomendado</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {nextRunAction
                    ? `${nextRunAction.run.playbookName}: ${nextRunAction.action.hint}`
                    : nextScaleAction
                      ? `${nextScaleAction.run.playbookName}: lift e margem positivos. Preparar nova safra com holdout novo.`
                    : topPlaybook
                      ? `${topPlaybook.name}: preparar tratamento, holdout e links de execucao.`
                      : "Sem playbook acionavel neste momento."}
                </p>
              </div>
              {nextRunAction ? (
                <Button asChild size="sm">
                  <Link href={nextRunAction.action.href}>
                    {nextRunAction.action.icon}
                    <span className="ml-1.5">{nextRunAction.action.label}</span>
                    <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              ) : nextScaleAction ? (
                <Button
                  size="sm"
                  onClick={() =>
                    preparePlaybook(nextScaleAction.playbook, {
                      runId: nextScaleAction.run.id,
                      decision: nextScaleAction.decision.tone,
                    })
                  }
                  disabled={preparingId !== null}
                >
                  {preparingId === nextScaleAction.playbook.id ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ListChecks className="mr-2 h-3.5 w-3.5" />
                  )}
                  Preparar nova safra
                </Button>
              ) : topPlaybook ? (
                <Button
                  size="sm"
                  onClick={() => preparePlaybook(topPlaybook)}
                  disabled={preparingId !== null || topPlaybook.audience.customers === 0}
                >
                  {preparingId === topPlaybook.id ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ListChecks className="mr-2 h-3.5 w-3.5" />
                  )}
                  Preparar execucao
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              icon={<Target className="h-4 w-4" />}
              label="Gap mensal"
              value={BRL(data.financial.revenueGap30)}
              hint={`${NUMBER(data.financial.orderGap30)} pedidos no ticket atual`}
            />
            <MetricCard
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Margem"
              value={PCT(data.financial.contributionBeforeMarketingPct)}
              hint={`${PCT(data.financial.contributionAfterMarketingPct)} apos midia planejada`}
            />
            <MetricCard
              icon={<WalletCards className="h-4 w-4" />}
              label="CPA salvo"
              value={data.acquisition.cpa == null ? "Sem dado" : BRL(data.acquisition.cpa)}
              hint={`${NUMBER(data.acquisition.purchases)} compras em campanhas salvas`}
            />
            <MetricCard
              icon={<Coins className="h-4 w-4" />}
              label="Cashback ativo"
              value={BRL(data.cashback.activeValue)}
              hint={`${NUMBER(data.cashback.activeCustomers)} clientes com saldo`}
            />
            <MetricCard
              icon={<MessageCircle className="h-4 w-4" />}
              label="Base 30d"
              value={NUMBER(data.crm.last30.customers)}
              hint={`${BRL(data.crm.last30.revenue)} em receita`}
            />
          </div>

          <StrategyBoard data={data} preparingId={preparingId} onPrepare={preparePlaybook} />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="rounded-md border bg-card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Agora</p>
              <p className="mt-2 text-lg font-semibold">{topPlaybook?.name ?? "Sem playbook"}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {topPlaybook
                  ? `${NUMBER(topPlaybook.audience.customers)} clientes, ${BRL(topPlaybook.estimate.contribution)} de contribuicao estimada.`
                  : "Aguardando dados suficientes."}
              </p>
            </div>
            <div className="rounded-md border bg-card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Teto de CAC</p>
              <p className="mt-2 text-lg font-semibold">{BRL(data.financial.firstOrderContribution)}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Contribuicao media antes de midia por pedido de {BRL(data.financial.avgOrderValue)}.
              </p>
            </div>
            <div className="rounded-md border bg-card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mensuracao</p>
              <p className="mt-2 text-lg font-semibold">
                Holdout {topPlaybook?.holdoutPct ?? data.measurement.holdoutPctDefault}% ·{" "}
                {topPlaybook?.attributionWindowDays ?? data.measurement.attributionWindowDays}d
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                KPI primario: {data.measurement.primaryMetric}. A janela varia por playbook.
              </p>
            </div>
          </div>

          <ReadinessPanel data={data} runs={runs} />

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">Fila recomendada</h2>
                <p className="text-sm text-muted-foreground">
                  Ordenada por contribuicao estimada, nao por receita bruta.
                </p>
              </div>
              <Badge variant="outline">
                {NUMBER(data.dataQuality.uniqueCustomers)} clientes · {NUMBER(data.dataQuality.uniqueOrders)} pedidos
              </Badge>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {data.playbooks.map((playbook) => (
                <Card key={playbook.id}>
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <CardTitle className="text-base">{playbook.name}</CardTitle>
                          <Badge variant={priorityVariant(playbook.priority)}>
                            {playbook.priority}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                          {playbook.stage}
                        </p>
                      </div>
                      <p className="text-right text-sm font-semibold text-primary">
                        {BRL(playbook.estimate.contribution)}
                      </p>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                      <div>
                        <p className="text-xs text-muted-foreground">Publico</p>
                        <p className="font-semibold">{NUMBER(playbook.audience.customers)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Pedidos</p>
                        <p className="font-semibold">{NUMBER(playbook.estimate.expectedOrders)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Receita</p>
                        <p className="font-semibold">{BRL(playbook.estimate.revenue)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Custo/pedido</p>
                        <p className="font-semibold">{BRL(playbook.estimate.retentionCostPerOrder)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Economia CPA</p>
                        <p className="font-semibold">
                          {playbook.estimate.cpaDelta == null
                            ? "sem CPA"
                            : playbook.estimate.cpaDelta >= 0
                              ? `+${BRL(playbook.estimate.cpaDelta)}`
                              : `-${BRL(Math.abs(playbook.estimate.cpaDelta))}`}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Minimo</p>
                        <p className="font-semibold">{PCT(playbook.estimate.breakEvenConversionPct)}</p>
                      </div>
                    </div>

                    <div className="grid gap-3 text-sm md:grid-cols-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Oferta</p>
                        <p className="mt-1">{playbook.offer}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Margem</p>
                        <p className="mt-1">{playbook.marginRule}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Incentivo</p>
                        <div className="mt-1 space-y-1">
                          <Badge variant={playbook.incentiveGuardrail.discountMaxPct > 0 ? "secondary" : "outline"}>
                            {playbook.incentiveGuardrail.label}
                          </Badge>
                          <p>{guardrailSummary(playbook.incentiveGuardrail)}</p>
                          <p className="text-xs text-muted-foreground">{playbook.incentiveGuardrail.reason}</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">Por que entra</p>
                      <p className="mt-1">{playbook.why}</p>
                      <p className="mt-2 font-medium text-foreground">Como medir</p>
                      <p className="mt-1">{playbook.measurement}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => preparePlaybook(playbook)}
                        disabled={preparingId !== null || playbook.audience.customers === 0}
                      >
                        {preparingId === playbook.id ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ListChecks className="mr-2 h-3.5 w-3.5" />
                        )}
                        Preparar execucao
                      </Button>
                      {playbook.actions.map((action) => (
                        <Button key={`${playbook.id}-${action.kind}`} asChild variant="outline" size="sm">
                          <Link href={action.href}>
                            {actionIcon(action.kind)}
                            <span className="ml-1.5">{action.label}</span>
                            <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">Execucoes recentes</h2>
                <p className="text-sm text-muted-foreground">
                  Canais preparados, holdout e resultado incremental por run.
                </p>
              </div>
              <Badge variant="outline">{NUMBER(runs.length)} runs</Badge>
            </div>

            {runs.length === 0 ? (
              <Card>
                <CardContent className="p-4 text-sm text-muted-foreground">
                  Nenhuma execucao preparada ainda.
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {runs.map((run) => {
                  const whatsapp = run.channels?.whatsapp;
                  const email = run.channels?.email;
                  const coupons = run.channels?.coupons;
                  const cashback = run.channels?.cashback;
                  const whatsappCampaigns = whatsapp?.campaigns ?? [];
                  const hasWhatsapp = (whatsapp?.campaignCount ?? 0) > 0;
                  const hasEmailDispatch = (email?.dispatchCount ?? 0) > 0;
                  const hasCouponPlan = (coupons?.planCount ?? 0) > 0;
                  const hasCashbackUsage = (cashback?.treatment.uses ?? 0) > 0 || (cashback?.holdout.uses ?? 0) > 0;
                  const scalePlaybook = data.playbooks.find((playbook) => playbook.id === run.playbookId);
                  const attributionWindowDays =
                    run.attributionWindowDays ??
                    playbookAttributionWindowDays(scalePlaybook, data.measurement.attributionWindowDays);
                  const decision = getRunDecision(run, attributionWindowDays);

                  return (
                    <Card key={run.id}>
                    <CardHeader className="pb-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-base">{run.playbookName}</CardTitle>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {new Date(run.createdAt).toLocaleDateString("pt-BR")} · {run.id.slice(0, 8)}
                            {run.sourceRunId ? ` · escala de ${run.sourceRunId.slice(0, 8)}` : ""}
                          </p>
                        </div>
                        <Badge variant={decisionVariant(decision.tone)}>{decision.label}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <RunExecutionChecklist
                        run={run}
                        attributionWindowDays={attributionWindowDays}
                      />
                      <RunDecisionPanel
                        run={run}
                        decision={decision}
                        scalePlaybook={scalePlaybook}
                        scaleDisabled={preparingId !== null || (scalePlaybook?.audience.customers ?? 0) === 0}
                        scaleLoading={Boolean(scalePlaybook && preparingId === scalePlaybook.id)}
                        onScale={(playbook, sourceRun, sourceDecision) =>
                          preparePlaybook(playbook, {
                            runId: sourceRun.id,
                            decision: sourceDecision.tone,
                          })
                        }
                      />

                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <div>
                          <p className="text-xs text-muted-foreground">Tratamento</p>
                          <p className="font-semibold">{NUMBER(run.treatmentList.totalCount)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Holdout</p>
                          <p className="font-semibold">{NUMBER(run.holdoutList?.totalCount ?? 0)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Conv. trat.</p>
                          <p className="font-semibold">{RATE(run.metrics.treatment.conversionRate)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Lift</p>
                          <p className="font-semibold">{RATE(run.metrics.liftConversion)}</p>
                        </div>
                      </div>

                      <div className="grid gap-3 text-sm md:grid-cols-4">
                        <div>
                          <p className="text-xs text-muted-foreground">Receita trat.</p>
                          <p className="font-semibold">{BRL(run.metrics.treatment.revenue)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Receita incremental</p>
                          <p className="font-semibold">{BRL(run.metrics.incrementalRevenue)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Custo canal/oferta</p>
                          <p className="font-semibold">
                            {BRL(run.metrics.trackedTotalCost ?? run.metrics.trackedChannelCost ?? 0)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Contribuicao liquida</p>
                          <p className="font-semibold text-primary">
                            {BRL(run.metrics.incrementalContribution)}
                          </p>
                        </div>
                      </div>

                      <div className="rounded-md border bg-muted/30 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold">WhatsApp vinculado</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {waStatusSummary(whatsapp?.statuses)}
                            </p>
                          </div>
                          <Badge variant={hasWhatsapp ? "secondary" : "outline"}>
                            {hasWhatsapp
                              ? `${NUMBER(whatsapp?.campaignCount ?? 0)} campanhas`
                              : "sem campanha"}
                          </Badge>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                          <div>
                            <p className="text-xs text-muted-foreground">Disparadas</p>
                            <p className="font-semibold">{NUMBER(whatsapp?.sent ?? 0)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Lidas</p>
                            <p className="font-semibold">{NUMBER(whatsapp?.read ?? 0)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Falhas</p>
                            <p className="font-semibold">{NUMBER(whatsapp?.failed ?? 0)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Custo WA</p>
                            <p className="font-semibold">{BRL(whatsapp?.costBrl ?? 0)}</p>
                          </div>
                        </div>

                        {whatsappCampaigns.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {whatsappCampaigns.map((campaign) => (
                              <div
                                key={campaign.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background px-3 py-2 text-xs"
                              >
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-foreground">{campaign.name}</p>
                                  <p className="text-muted-foreground">
                                    {new Date(campaign.createdAt).toLocaleDateString("pt-BR")} ·{" "}
                                    {waStatusLabel(campaign.status)}
                                  </p>
                                </div>
                                <div className="text-right text-muted-foreground">
                                  <p>{NUMBER(campaign.sent)} envios</p>
                                  <p>{BRL(campaign.costBrl)}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="grid gap-3 text-sm 2xl:grid-cols-3">
                        <div className="rounded-md border bg-muted/30 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold">Email vinculado</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {compactStatusSummary(email?.statuses)}
                              </p>
                            </div>
                            <Badge variant={hasEmailDispatch ? "secondary" : "outline"}>
                              {hasEmailDispatch
                                ? `${NUMBER(email?.dispatchCount ?? 0)} disparos`
                                : email?.listReady
                                  ? "lista pronta"
                                  : "sem lista"}
                            </Badge>
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-3">
                            <div>
                              <p className="text-xs text-muted-foreground">Enviados</p>
                              <p className="font-semibold">{NUMBER(email?.sent ?? 0)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Aberturas</p>
                              <p className="font-semibold">{NUMBER(email?.opens ?? 0)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Cliques</p>
                              <p className="font-semibold">{NUMBER(email?.clicks ?? 0)}</p>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-md border bg-muted/30 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold">Cashback do run</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Tratamento {RATE(cashback?.treatment.usageRate ?? 0)} · holdout {RATE(cashback?.holdout.usageRate ?? 0)}
                              </p>
                            </div>
                            <Badge variant={hasCashbackUsage ? "secondary" : "outline"}>
                              {hasCashbackUsage
                                ? `${NUMBER(cashback?.treatment.uses ?? 0)} usos`
                                : "sem uso"}
                            </Badge>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-3">
                            <div>
                              <p className="text-xs text-muted-foreground">Usos trat.</p>
                              <p className="font-semibold">{NUMBER(cashback?.treatment.uses ?? 0)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Saldo usado</p>
                              <p className="font-semibold">{BRL(cashback?.treatment.cashbackValue ?? 0)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Lift uso</p>
                              <p className="font-semibold">{RATE(cashback?.liftUsageRate ?? 0)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Incremental</p>
                              <p className="font-semibold">{BRL(cashback?.incrementalCashbackValue ?? 0)}</p>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-md border bg-muted/30 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold">Cupom VNDA vinculado</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {compactStatusSummary(coupons?.statuses, COUPON_STATUS_LABELS)}
                              </p>
                            </div>
                            <Badge variant={hasCouponPlan ? "secondary" : "outline"}>
                              {hasCouponPlan
                                ? `${NUMBER(coupons?.planCount ?? 0)} planos`
                                : "sem plano"}
                            </Badge>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-3">
                            <div>
                              <p className="text-xs text-muted-foreground">Cupons</p>
                              <p className="font-semibold">{NUMBER(coupons?.couponCount ?? 0)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Usos</p>
                              <p className="font-semibold">{NUMBER(coupons?.attributedUnits ?? 0)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Receita janela</p>
                              <p className="font-semibold">{BRL(coupons?.attributedRevenue ?? 0)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Incentivo janela</p>
                              <p className="font-semibold">{BRL(coupons?.attributedDiscount ?? 0)}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
