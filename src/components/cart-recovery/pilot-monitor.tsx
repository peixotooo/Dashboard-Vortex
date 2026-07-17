"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  HelpCircle,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type GroupMetrics = {
  sample: number;
  recovered: number;
  recovery_rate: number;
  recovered_value: number;
  revenue_per_cart: number;
  sent_messages: number;
  messages_per_cart: number;
  median_recovery_hours: number | null;
};

type PilotData = {
  generated_at: string;
  mode: "shadow" | "pilot" | "active";
  enabled: boolean;
  rollout_percentage: number;
  holdout_percentage: number;
  pilot_started_at: string | null;
  maturity_hours: number;
  minimum_sample_per_group: number;
  groups: {
    all: { pilot: GroupMetrics; control: GroupMetrics };
    mature: { pilot: GroupMetrics; control: GroupMetrics };
  };
  comparison: {
    recovery_rate_pilot: number;
    recovery_rate_control: number;
    uplift_points: number;
    relative_uplift: number | null;
    revenue_per_cart_pilot: number;
    revenue_per_cart_control: number;
    revenue_per_cart_lift: number;
    estimated_incremental_revenue: number;
    confidence: number;
    sample_ready: boolean;
    verdict: "collecting" | "winner" | "loser" | "inconclusive";
  };
  progress: {
    pilot: number;
    control: number;
    estimated_days_remaining: number | null;
    enrollment_per_day: { pilot: number; control: number };
  };
  health: {
    queue_total: number;
    queue_status: Record<string, number>;
    queue_failure_rate: number;
    message_status: Record<string, number>;
    whatsapp_delivery_status: Record<string, number>;
    healthy: boolean;
  };
};

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function CartRecoveryPilotMonitor({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [data, setData] = useState<PilotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const response = await fetch("/api/crm/cart-recovery/pilot", {
          headers: { "x-workspace-id": workspaceId },
          cache: "no-store",
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error || "Falha ao carregar o piloto");
        setData(body as PilotData);
        setError(null);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Falha ao carregar o piloto",
        );
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const togglePilot = async () => {
    if (!data) return;
    const enabling = data.mode !== "pilot";
    const confirmed = window.confirm(
      enabling
        ? "Iniciar o piloto em 10% dos carrinhos elegíveis? Outros 10% ficam como controle e 80% seguem na régua atual."
        : "Pausar o piloto? Contatos ainda programados voltam para a régua padrão.",
    );
    if (!confirmed) return;
    setSaving(true);
    try {
      const response = await fetch("/api/crm/cart-recovery/pilot", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({ enabled: enabling, rollout_percentage: 10 }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Falha ao alterar o piloto");
      await load(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Falha ao alterar o piloto",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex h-28 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="flex min-h-28 items-center justify-between gap-4 py-5">
          <p className="text-sm text-destructive">
            {error || "Piloto indisponível"}
          </p>
          <Button variant="outline" size="sm" onClick={() => load()}>
            <RefreshCw className="size-4" />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  const active = data.mode === "pilot";
  const mature = data.groups.mature;
  const all = data.groups.all;
  const verdict = verdictCopy(data);
  const baselinePercentage = Math.max(
    0,
    100 - data.rollout_percentage - data.holdout_percentage,
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="size-4" />
                Piloto de recuperação inteligente
              </CardTitle>
              <Badge variant={active ? "default" : "secondary"}>
                {active ? "Em andamento" : "Em observação"}
              </Badge>
              <Badge variant="outline">{verdict.label}</Badge>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Primeiro contato com canal e horário inteligentes. Os demais
              contatos permanecem iguais.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => load()}
              aria-label="Atualizar piloto"
            >
              <RefreshCw className="size-4" />
            </Button>
            <Button
              variant={active ? "outline" : "default"}
              size="sm"
              onClick={togglePilot}
              disabled={saving || !data.enabled}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : active ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
              {active ? "Pausar" : "Iniciar em 10%"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 py-5">
        <div>
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium">
              Distribuição dos próximos elegíveis
            </span>
            <span className="text-muted-foreground">
              alocação fixa por carrinho
            </span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="bg-foreground"
              style={{ width: `${data.rollout_percentage}%` }}
            />
            <div
              className="bg-muted-foreground/45"
              style={{ width: `${data.holdout_percentage}%` }}
            />
            <div
              className="bg-muted"
              style={{ width: `${baselinePercentage}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
            <LegendDot
              className="bg-foreground"
              label={`Piloto ${data.rollout_percentage}%`}
            />
            <LegendDot
              className="bg-muted-foreground/45"
              label={`Controle ${data.holdout_percentage}%`}
            />
            <LegendDot
              className="border bg-muted"
              label={`Régua atual ${baselinePercentage}%`}
            />
          </div>
        </div>

        <div className="grid overflow-hidden rounded-md border sm:grid-cols-2 lg:grid-cols-4 lg:divide-x">
          <PilotMetric
            label="Recuperação piloto"
            value={formatPercent(mature.pilot.recovery_rate)}
            detail={`${mature.pilot.recovered} de ${mature.pilot.sample} maduros`}
            help="Carrinhos do piloto que compraram após entrar no teste e já completaram a janela de 96 horas."
          />
          <PilotMetric
            label="Recuperação controle"
            value={formatPercent(mature.control.recovery_rate)}
            detail={`${mature.control.recovered} de ${mature.control.sample} maduros`}
            help="Carrinhos equivalentes que continuaram recebendo somente a régua tradicional."
          />
          <PilotMetric
            label="Diferença"
            value={signedPoints(data.comparison.uplift_points)}
            detail={`${Math.round(data.comparison.confidence * 100)}% de confiança`}
            help="Diferença entre as taxas maduras do piloto e do controle. Só vira decisão após 100 casos maduros por grupo."
            tone={data.comparison.sample_ready ? verdict.tone : "neutral"}
          />
          <PilotMetric
            label="Receita por carrinho"
            value={BRL.format(data.comparison.revenue_per_cart_pilot)}
            detail={`controle ${BRL.format(data.comparison.revenue_per_cart_control)}`}
            help="Valor recuperado dividido por todos os carrinhos maduros do grupo, inclusive os que não converteram."
          />
        </div>

        <div className="grid gap-5 border-t pt-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Amostra madura</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Não tomaremos decisão antes de {data.minimum_sample_per_group}{" "}
                  carrinhos por grupo.
                </p>
              </div>
              {data.progress.estimated_days_remaining != null && (
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  estimativa: {data.progress.estimated_days_remaining} dias
                </span>
              )}
            </div>
            <SampleProgress
              label="Piloto"
              value={mature.pilot.sample}
              total={data.minimum_sample_per_group}
              progress={data.progress.pilot}
            />
            <SampleProgress
              label="Controle"
              value={mature.control.sample}
              total={data.minimum_sample_per_group}
              progress={data.progress.control}
            />
            <p className="text-[11px] text-muted-foreground">
              Entraram até agora: {all.pilot.sample} no piloto e{" "}
              {all.control.sample} no controle. Casos com menos de{" "}
              {data.maturity_hours}h ainda não entram na comparação principal.
            </p>
          </div>

          <div className="border-t pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck
                className={cn(
                  "size-4",
                  data.health.healthy ? "text-success" : "text-warning",
                )}
              />
              Saúde operacional
            </div>
            <dl className="mt-3 space-y-2 text-xs">
              <HealthRow
                label="Fila programada"
                value={String(data.health.queue_status.scheduled || 0)}
              />
              <HealthRow
                label="Contatos enviados"
                value={String(data.health.queue_status.sent || 0)}
              />
              <HealthRow
                label="Falhas com fallback"
                value={String(data.health.queue_status.failed || 0)}
              />
              <HealthRow
                label="WhatsApp entregue/lido"
                value={String(
                  (data.health.whatsapp_delivery_status.delivered || 0) +
                    (data.health.whatsapp_delivery_status.read || 0),
                )}
              />
              <HealthRow
                label="Taxa de falha"
                value={formatPercent(data.health.queue_failure_rate)}
              />
            </dl>
            <div
              className={cn(
                "mt-4 rounded-md border px-3 py-2 text-xs leading-relaxed",
                data.health.healthy
                  ? "bg-muted/35"
                  : "border-warning/40 bg-warning/10",
              )}
            >
              {data.health.healthy
                ? "Fila saudável. Compras cancelam o contato e falhas voltam automaticamente à régua atual."
                : "Atenção operacional: o piloto deve permanecer limitado até a fila voltar aos limites esperados."}
            </div>
          </div>
        </div>

        {error && (
          <p className="text-xs text-destructive">
            Última atualização: {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PilotMetric({
  label,
  value,
  detail,
  help,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  help: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  return (
    <div className="min-w-0 border-b px-4 py-4 last:border-b-0 sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:[&:nth-child(odd)]:border-r-0">
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase text-muted-foreground">
        {label}
        <InfoTip text={help} />
      </div>
      <div
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          tone === "positive" && "text-success",
          tone === "negative" && "text-destructive",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function SampleProgress({
  label,
  value,
  total,
  progress,
}: {
  label: string;
  value: number;
  total: number;
  progress: number;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="font-mono text-muted-foreground">
          {value}/{total}
        </span>
      </div>
      <Progress value={progress * 100} className="h-1.5" />
    </div>
  );
}

function HealthRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono font-medium">{value}</dd>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", className)} />
      {label}
    </span>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={120}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Explicação"
            className="text-muted-foreground/70 hover:text-foreground"
          >
            <HelpCircle className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function verdictCopy(data: PilotData) {
  if (!data.comparison.sample_ready) {
    return { label: "Coletando amostra", tone: "neutral" as const };
  }
  if (data.comparison.verdict === "winner") {
    return { label: "Piloto vencedor", tone: "positive" as const };
  }
  if (data.comparison.verdict === "loser") {
    return { label: "Controle superior", tone: "negative" as const };
  }
  return { label: "Sem diferença conclusiva", tone: "neutral" as const };
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function signedPoints(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)} p.p.`;
}
