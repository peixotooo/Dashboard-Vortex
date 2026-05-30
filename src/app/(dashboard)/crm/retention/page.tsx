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

const BRL = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const NUMBER = (value: number) => value.toLocaleString("pt-BR");

const PCT = (value: number) => `${value.toFixed(1)}%`;

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
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/crm/retention-playbooks/summary", {
        headers: { "x-workspace-id": workspaceId },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Erro ao carregar playbooks");
      setData(payload);
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
