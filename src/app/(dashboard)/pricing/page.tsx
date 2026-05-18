"use client";

// Landing do módulo de Pricing — dashboard operacional.
//
// Objetivos:
//   1. Mostrar saúde da operação num olhar (KPIs)
//   2. Tornar óbvio o que precisa de ação ("Painel de Ação")
//   3. Análise resumida (matriz idade × margem inline)
//   4. Atalhos pras telas profundas

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Target,
  Package,
  Banknote,
  ListOrdered,
  Calculator,
  Tag,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

type Overview = {
  kpis: {
    total_skus: number;
    skus_com_pricing: number;
    pct_estoque_ate_120d: number;
    margem_media_ponderada_pct: number;
    desconto_medio_ponderado_pct: number;
    skus_em_markdown: number;
    skus_em_markup: number;
  };
  idade_margem: Array<{
    label: string;
    margem_pct: number;
    desconto_pct: number;
    share_estoque_pct: number;
    share_faturamento_pct: number;
    sku_count: number;
  }>;
  trava_desconto: Array<{
    trava: "alta" | "media" | "baixa";
    desconto: "alto" | "medio" | "baixo";
    health: "green" | "yellow" | "red";
    label: string;
    sku_count: number;
  }>;
};

type Pending = {
  evento: string;
  status: string;
  margem_pct: number | null;
  rule_applied: { trava_margem_minima_pct?: number };
};

export default function PricingLandingPage() {
  const { workspace } = useWorkspace();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspace?.id) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [ov, pd] = await Promise.all([
          fetch("/api/pricing/overview", {
            headers: { "x-workspace-id": workspace!.id },
          }).then((r) => r.json()),
          fetch(
            "/api/pricing/engine/pending?status=pending,approved&limit=500",
            { headers: { "x-workspace-id": workspace!.id } }
          ).then((r) => r.json()),
        ]);
        if (!cancelled) {
          setOverview(ov);
          setPending(pd.items ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [workspace?.id]);

  const buckets = useMemo(() => {
    const pendingOnly = pending.filter((p) => p.status === "pending");
    const markdown = pendingOnly.filter((p) => p.evento === "markdown");
    const markup = pendingOnly.filter((p) => p.evento === "markup");
    const risk = pendingOnly.filter((p) => {
      const trava = Number(p.rule_applied?.trava_margem_minima_pct ?? 0.1);
      return p.margem_pct != null && p.margem_pct < trava;
    });
    const greenZone = pendingOnly.filter((p) => {
      const trava = Number(p.rule_applied?.trava_margem_minima_pct ?? 0.1);
      return p.margem_pct != null && p.margem_pct >= trava + 0.1;
    });
    return {
      pending: pendingOnly.length,
      approved: pending.filter((p) => p.status === "approved").length,
      markdown: markdown.length,
      markup: markup.length,
      risk: risk.length,
      greenZone: greenZone.length,
    };
  }, [pending]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pct120d = overview?.kpis.pct_estoque_ate_120d ?? 0;
  const meta120d = pct120d >= 90;
  const gap120d = 90 - pct120d;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Pricing</h1>
          <p className="text-sm text-muted-foreground">
            Saúde da operação, decisões pendentes e análise por idade.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/pricing/skus">
            <Button variant="outline" size="sm" className="gap-1">
              <Package className="h-3 w-3" /> SKUs
            </Button>
          </Link>
          <Link href="/pricing/config">
            <Button variant="outline" size="sm" className="gap-1">
              <SlidersHorizontal className="h-3 w-3" /> Configurar
            </Button>
          </Link>
        </div>
      </div>

      {/* META ESTRATÉGICA — norte do módulo (SDD G4) */}
      <Card
        className={cn(
          "border-2",
          meta120d
            ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950"
            : pct120d >= 75
              ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950"
              : "border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950"
        )}
      >
        <CardContent className="p-5">
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Target className="h-3 w-3" /> Meta estratégica · SDD G4
              </div>
              <div className="mt-1 text-sm font-medium">
                Estoque com idade até 120 dias
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span
                  className={cn(
                    "text-5xl font-semibold tracking-tight",
                    meta120d
                      ? "text-emerald-700 dark:text-emerald-300"
                      : pct120d >= 75
                        ? "text-amber-700 dark:text-amber-300"
                        : "text-rose-700 dark:text-rose-300"
                  )}
                >
                  {pct120d.toFixed(0)}%
                </span>
                <span className="text-base text-muted-foreground">/ meta 90%</span>
              </div>
              {!meta120d && gap120d > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Faltam {gap120d.toFixed(0)}pp pra atingir a meta. Aprovar
                  markdowns nos SKUs &gt; 120d acelera.
                </div>
              )}
              {meta120d && (
                <div className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                  ✓ Capital de giro saudável. Continue rodando o engine
                  semanalmente.
                </div>
              )}
            </div>
            {/* Gauge visual: barra horizontal com marcador da meta */}
            <div className="hidden flex-col items-end gap-1 md:flex">
              <div className="relative h-3 w-48 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "absolute inset-y-0 left-0",
                    meta120d
                      ? "bg-emerald-500"
                      : pct120d >= 75
                        ? "bg-amber-500"
                        : "bg-rose-500"
                  )}
                  style={{ width: `${Math.min(100, pct120d)}%` }}
                />
                {/* Marcador da meta */}
                <div
                  className="absolute inset-y-0 w-0.5 bg-foreground/40"
                  style={{ left: "90%" }}
                />
              </div>
              <div className="text-[10px] text-muted-foreground">
                ↑ posição da meta 90%
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* PAINEL DE AÇÃO — protagonista */}
      {buckets.pending > 0 ? (
        <Card className="border-2 border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
          <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-100">
                <AlertTriangle className="h-4 w-4" /> Ação necessária
              </div>
              <div className="mt-1 text-3xl font-semibold tracking-tight text-amber-950 dark:text-amber-50">
                {buckets.pending} decisões pendentes
              </div>
              <div className="mt-1 text-xs text-amber-900 dark:text-amber-200">
                {buckets.markdown} markdowns · {buckets.markup} markups · {buckets.greenZone} na
                zona verde (prontas pra aprovar em lote)
              </div>
            </div>
            <Link href="/pricing/decisoes">
              <Button size="lg" className="gap-2 bg-amber-600 hover:bg-amber-700">
                Revisar decisões <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : buckets.approved > 0 ? (
        <Card className="border-2 border-blue-300 bg-blue-50 dark:border-blue-900 dark:bg-blue-950">
          <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm font-medium text-blue-900 dark:text-blue-100">
                <CheckCircle2 className="h-4 w-4" /> Pronto pra aplicar
              </div>
              <div className="mt-1 text-3xl font-semibold tracking-tight text-blue-950 dark:text-blue-50">
                {buckets.approved} decisões aprovadas
              </div>
              <div className="mt-1 text-xs text-blue-900 dark:text-blue-200">
                Aplicar agora propaga sale_price na VNDA.
              </div>
            </div>
            <Link href="/pricing/decisoes">
              <Button size="lg" className="gap-2">
                Aplicar na VNDA <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950">
          <CardContent className="flex items-center gap-3 p-5">
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            <div className="flex-1">
              <div className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                Nenhuma decisão pendente
              </div>
              <div className="text-xs text-emerald-800 dark:text-emerald-200">
                Engine vai rodar novamente no próximo ciclo (cron diário 5h UTC).
              </div>
            </div>
            <Link href="/pricing/config">
              <Button variant="outline" size="sm">
                Rodar agora
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          icon={<Target className="h-4 w-4" />}
          label="Estoque ≤ 120 dias"
          value={`${(overview?.kpis.pct_estoque_ate_120d ?? 0).toFixed(0)}%`}
          hint="meta 90%"
          tone={meta120d ? "good" : "bad"}
        />
        <Kpi
          icon={<Banknote className="h-4 w-4" />}
          label="Margem ponderada"
          value={`${(overview?.kpis.margem_media_ponderada_pct ?? 0).toFixed(1)}%`}
        />
        <Kpi
          icon={<TrendingDown className="h-4 w-4" />}
          label="Desconto médio"
          value={`${(overview?.kpis.desconto_medio_ponderado_pct ?? 0).toFixed(1)}%`}
        />
        <Kpi
          icon={<Package className="h-4 w-4" />}
          label="SKUs com composição"
          value={`${overview?.kpis.skus_com_pricing ?? 0}`}
          hint={`de ${overview?.kpis.total_skus ?? 0} ativos`}
        />
      </div>

      {/* Matriz Idade × Margem inline (resumida) */}
      {overview && overview.idade_margem.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span>Saúde por idade de estoque</span>
              <Link href="/pricing/visao-geral">
                <Button variant="ghost" size="sm" className="gap-1">
                  Análise completa <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="p-2 text-left font-normal"></th>
                    {overview.idade_margem.map((b) => (
                      <th key={b.label} className="p-2 text-right font-normal">
                        {b.label}d
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="p-2 font-medium">Margem média</td>
                    {overview.idade_margem.map((b) => (
                      <td
                        key={b.label}
                        className={cn(
                          "p-2 text-right",
                          b.margem_pct >= 30
                            ? "text-emerald-600"
                            : b.margem_pct >= 15
                              ? "text-amber-600"
                              : b.margem_pct > 0
                                ? "text-rose-600"
                                : "text-muted-foreground"
                        )}
                      >
                        {b.margem_pct > 0 ? `${b.margem_pct.toFixed(0)}%` : "—"}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-t">
                    <td className="p-2 font-medium">Desconto médio</td>
                    {overview.idade_margem.map((b) => (
                      <td key={b.label} className="p-2 text-right">
                        {b.desconto_pct > 0 ? `${b.desconto_pct.toFixed(0)}%` : "—"}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-t">
                    <td className="p-2 font-medium">Share estoque</td>
                    {overview.idade_margem.map((b) => (
                      <td
                        key={b.label}
                        className={cn(
                          "p-2 text-right",
                          b.label === "121+" && b.share_estoque_pct > 10
                            ? "font-medium text-rose-600"
                            : ""
                        )}
                      >
                        {b.share_estoque_pct.toFixed(0)}%
                      </td>
                    ))}
                  </tr>
                  <tr className="border-t">
                    <td className="p-2 font-medium">Share faturamento</td>
                    {overview.idade_margem.map((b) => (
                      <td key={b.label} className="p-2 text-right">
                        {b.share_faturamento_pct.toFixed(0)}%
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Atalhos */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ferramentas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <ToolCard
              href="/pricing/simulador"
              icon={<Calculator className="h-5 w-5" />}
              title="Simulador de elasticidade"
              description="Testar cenários de preço por canal antes de aplicar"
            />
            <ToolCard
              href="/pricing/campanhas"
              icon={<Tag className="h-5 w-5" />}
              title="Campanhas / Combos"
              description="Bundles que sobrepõem o pricing dinâmico"
            />
            <ToolCard
              href="/pricing/skus"
              icon={<ListOrdered className="h-5 w-5" />}
              title="Lista de SKUs"
              description="Ver e editar composição de preço SKU a SKU"
            />
          </div>
        </CardContent>
      </Card>

      {buckets.risk > 0 && (
        <Card className="border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950">
          <CardContent className="flex items-center gap-3 p-4 text-sm">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" />
            <div className="flex-1">
              <span className="font-medium text-rose-900 dark:text-rose-100">
                {buckets.risk} decisões com risco de margem
              </span>
              <span className="text-rose-800 dark:text-rose-200">
                {" "}— preço novo ficaria abaixo da trava mínima.
              </span>
            </div>
            <Link href="/pricing/decisoes">
              <Button variant="outline" size="sm">
                Ver
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {icon} {label}
        </div>
        <div
          className={cn(
            "mt-1 text-2xl font-semibold tracking-tight",
            tone === "good" && "text-emerald-600",
            tone === "bad" && "text-rose-600"
          )}
        >
          {value}
        </div>
        {hint && (
          <div className="text-xs text-muted-foreground">{hint}</div>
        )}
      </CardContent>
    </Card>
  );
}

function ToolCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-md border p-3 transition hover:border-foreground hover:bg-muted/30"
    >
      <div className="rounded-md bg-muted p-2 text-muted-foreground group-hover:bg-background">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
      </div>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-foreground" />
    </Link>
  );
}
