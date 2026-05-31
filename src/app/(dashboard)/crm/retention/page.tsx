"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Coins,
  ListChecks,
  Loader2,
  Mail,
  MessageCircle,
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
  conversionPct: number;
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

interface RunReport {
  id: string;
  playbookName: string;
  createdAt: string;
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
    trackedOfferCost?: number;
    trackedTotalCost?: number;
  };
  channels?: {
    whatsapp?: WhatsAppRunSummary;
    email?: EmailRunSummary;
    coupons?: CouponRunSummary;
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

function runNeedsCoupon(playbookName: string) {
  return /cupom|segunda|recorrentes|dormantes|winback/i.test(playbookName);
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
  return `/crm/email-templates?${params.toString()}`;
}

function getRunNextAction(run: RunReport) {
  const whatsapp = run.channels?.whatsapp;
  const email = run.channels?.email;
  const coupons = run.channels?.coupons;
  const whatsappReady = (whatsapp?.campaignCount ?? 0) > 0;
  const emailReady = Boolean(email?.listReady);
  const emailSent = (email?.dispatchCount ?? 0) > 0;
  const needsCoupon = runNeedsCoupon(run.playbookName);
  const couponReady = (coupons?.planCount ?? 0) > 0;

  if (needsCoupon && !couponReady) {
    return {
      label: "Criar cupom VNDA",
      href: run.links.coupons,
      hint: "Primeiro prepare a oferta que vai entrar na mensagem.",
      icon: <Tag className="h-3.5 w-3.5" />,
    };
  }

  if (!whatsappReady && run.treatmentList.phoneCount > 0) {
    return {
      label: "Criar WhatsApp",
      href: run.links.whatsapp,
      hint: "Use a lista de tratamento ja ligada ao holdout.",
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

  if (emailReady && !emailSent) {
    return {
      label: "Criar email",
      href: emailTemplatesHref(run),
      hint: "A lista ja esta pronta para ser usada no disparo.",
      icon: <Mail className="h-3.5 w-3.5" />,
    };
  }

  return {
    label: "Acompanhar resultado",
    href: "/crm/retention",
    hint: "Canais principais preparados; acompanhe lift, receita e contribuicao.",
    icon: <BarChart3 className="h-3.5 w-3.5" />,
  };
}

type ExecutionStepState = "ready" | "todo" | "optional";

const EXECUTION_STATE_LABELS: Record<ExecutionStepState, string> = {
  ready: "pronto",
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

function RunExecutionChecklist({ run }: { run: RunReport }) {
  const whatsapp = run.channels?.whatsapp;
  const email = run.channels?.email;
  const coupons = run.channels?.coupons;
  const hasHoldout = (run.holdoutList?.totalCount ?? 0) > 0;
  const whatsappReady = (whatsapp?.campaignCount ?? 0) > 0;
  const emailReady = Boolean(email?.listReady);
  const needsCoupon = runNeedsCoupon(run.playbookName);
  const couponReady = (coupons?.planCount ?? 0) > 0;
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
          <Badge variant={whatsappReady && hasHoldout ? "secondary" : "outline"}>
            {whatsappReady && hasHoldout ? "medindo" : "preparando"}
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
      <p className="mt-2 text-xs text-muted-foreground">Proximo clique: {nextAction.hint}</p>

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
          state={whatsappReady ? "ready" : "todo"}
          hint={
            whatsappReady
              ? `${NUMBER(whatsapp?.sent ?? 0)} envios vinculados`
              : `${NUMBER(run.treatmentList.phoneCount)} contatos com telefone`
          }
          href={run.links.whatsapp}
          actionLabel={whatsappReady ? "Abrir" : "Criar"}
        />
        <ExecutionStep
          icon={<Mail className="h-3.5 w-3.5" />}
          label="Email"
          state={emailReady ? "ready" : "todo"}
          hint={
            (email?.dispatchCount ?? 0) > 0
              ? `${NUMBER(email?.dispatchCount ?? 0)} disparos vinculados`
              : emailReady
              ? `Lista Locaweb pronta`
              : `${NUMBER(email?.emailContacts ?? run.treatmentList.emailCount)} contatos com email`
          }
          href={emailReady ? run.links.lists : run.links.email}
          actionLabel={emailReady ? "Abrir" : "Promover"}
        />
        <ExecutionStep
          icon={<Tag className="h-3.5 w-3.5" />}
          label="Cupom"
          state={couponReady ? "ready" : needsCoupon ? "todo" : "optional"}
          hint={
            couponReady
              ? `${NUMBER(coupons?.couponCount ?? 0)} cupons · ${BRL(coupons?.attributedRevenue ?? 0)} atribuido`
              : needsCoupon
              ? "Oferta precisa de plano VNDA"
              : "Sem desconto novo como padrao"
          }
          href={run.links.coupons}
          actionLabel={needsCoupon ? "Criar" : "Avaliar"}
        />
        <ExecutionStep
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          label="Medicao"
          state={hasHoldout ? "ready" : "todo"}
          hint={
            hasHoldout
              ? `Holdout ${NUMBER(run.holdoutList?.totalCount ?? 0)} ativo`
              : "Sem grupo de controle"
          }
        />
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
  const measurementStatus: ReadinessStatus =
    runsWithHoldout > 0 ? "ready" : runs.length > 0 ? "attention" : "todo";
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
      value: `${NUMBER(runs.length)} runs`,
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

  async function preparePlaybook(playbook: RetentionPlaybook) {
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
          holdoutPct: data?.measurement.holdoutPctDefault ?? 10,
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
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm">
                    <Link href={preparedRun.links.whatsapp}>
                      <MessageCircle className="mr-2 h-4 w-4" />
                      Criar WhatsApp
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href={preparedRun.links.email}>
                      <Mail className="mr-2 h-4 w-4" />
                      Email
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href={preparedRun.links.coupons}>
                      <Tag className="mr-2 h-4 w-4" />
                      Cupom
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href={preparedRun.links.lists}>
                      <ListChecks className="mr-2 h-4 w-4" />
                      Listas
                    </Link>
                  </Button>
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
                Holdout {data.measurement.holdoutPctDefault}% · {data.measurement.attributionWindowDays}d
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                KPI primario: {data.measurement.primaryMetric}.
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
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
                        <p className="text-xs text-muted-foreground">Conv.</p>
                        <p className="font-semibold">{PCT(playbook.estimate.conversionPct)}</p>
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
                  const whatsappCampaigns = whatsapp?.campaigns ?? [];
                  const hasWhatsapp = (whatsapp?.campaignCount ?? 0) > 0;
                  const hasEmailDispatch = (email?.dispatchCount ?? 0) > 0;
                  const hasCouponPlan = (coupons?.planCount ?? 0) > 0;

                  return (
                    <Card key={run.id}>
                    <CardHeader className="pb-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-base">{run.playbookName}</CardTitle>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {new Date(run.createdAt).toLocaleDateString("pt-BR")} · {run.id.slice(0, 8)}
                          </p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <RunExecutionChecklist run={run} />

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

                      <div className="grid gap-3 text-sm md:grid-cols-2">
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
                          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                            <div>
                              <p className="text-xs text-muted-foreground">Cupons</p>
                              <p className="font-semibold">{NUMBER(coupons?.couponCount ?? 0)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Usos</p>
                              <p className="font-semibold">{NUMBER(coupons?.attributedUnits ?? 0)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Receita</p>
                              <p className="font-semibold">{BRL(coupons?.attributedRevenue ?? 0)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Incentivo</p>
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
