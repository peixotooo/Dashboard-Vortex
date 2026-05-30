"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
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

interface SummaryResponse {
  generatedAt: string;
  dataQuality: {
    crmOrdersLoaded: number;
    uniqueOrders: number;
    uniqueCustomers: number;
    savedCampaignsAreCpaProxy: boolean;
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
  };
  holdoutList: {
    id: string;
    name: string;
    total_count: number;
    phone_count: number;
    email_count: number;
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
  };
  holdoutList: {
    id: string;
    name: string;
    totalCount: number;
    phoneCount: number;
    emailCount: number;
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
  };
  channels?: {
    whatsapp?: WhatsAppRunSummary;
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

                    <div className="grid gap-3 text-sm md:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Oferta</p>
                        <p className="mt-1">{playbook.offer}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Margem</p>
                        <p className="mt-1">{playbook.marginRule}</p>
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
                  Comparativo tratamento vs holdout desde a criacao da lista.
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
                  const whatsappCampaigns = whatsapp?.campaigns ?? [];
                  const hasWhatsapp = (whatsapp?.campaignCount ?? 0) > 0;

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
                        <Button asChild variant="outline" size="sm">
                          <Link href={run.links.whatsapp}>
                            <MessageCircle className="mr-2 h-3.5 w-3.5" />
                            WhatsApp
                          </Link>
                        </Button>
                        <Button asChild variant="outline" size="sm">
                          <Link href={run.links.email}>
                            <Mail className="mr-2 h-3.5 w-3.5" />
                            Email
                          </Link>
                        </Button>
                        <Button asChild variant="outline" size="sm">
                          <Link href={run.links.coupons}>
                            <Tag className="mr-2 h-3.5 w-3.5" />
                            Cupom
                          </Link>
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
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
                          <p className="text-xs text-muted-foreground">Custo canal</p>
                          <p className="font-semibold">{BRL(run.metrics.trackedChannelCost ?? 0)}</p>
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
                    </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">O que ja esta pronto</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div>
                  <p className="text-muted-foreground">Campanhas WA</p>
                  <p className="font-semibold">{NUMBER(data.capabilities.waCampaigns)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Templates WA</p>
                  <p className="font-semibold">{NUMBER(data.capabilities.waTemplates)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Emails</p>
                  <p className="font-semibold">{NUMBER(data.capabilities.emailDrafts)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Cupons</p>
                  <p className="font-semibold">{NUMBER(data.capabilities.couponPlans)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Listas</p>
                  <p className="font-semibold">{NUMBER(data.capabilities.contactLists)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Régua cashback</p>
                  <p className="font-semibold">{NUMBER(data.capabilities.cashbackTemplates)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Relatorios email</p>
                  <p className="font-semibold">{NUMBER(data.capabilities.emailReports)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Cupons ativos</p>
                  <p className="font-semibold">{NUMBER(data.capabilities.activeCoupons)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Proximas travas de escala</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex gap-3">
                  <Badge variant="secondary">1</Badge>
                  <p>Salvar cada disparo como run unico com audiencia, holdout, template, cupom e custo.</p>
                </div>
                <div className="flex gap-3">
                  <Badge variant="secondary">2</Badge>
                  <p>Aplicar guardrail de margem por produto antes de liberar cupom ou cashback extra.</p>
                </div>
                <div className="flex gap-3">
                  <Badge variant="secondary">3</Badge>
                  <p>Unificar WhatsApp, email, cupom e cashback em um relatorio de margem incremental.</p>
                </div>
              </CardContent>
            </Card>
          </section>
        </>
      ) : null}
    </div>
  );
}
