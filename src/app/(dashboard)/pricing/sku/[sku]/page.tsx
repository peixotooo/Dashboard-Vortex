"use client";

// Detalhe de SKU — hero "Decisão recomendada" no topo, composição em tabs
// abaixo. Foco: usuário entra aqui pra entender por que o engine decidiu X
// e decidir aprovar/rejeitar; editar composição é tarefa secundária.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Save,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRight,
  Package,
  TrendingDown,
  TrendingUp,
  Send,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/lib/workspace-context";
import { formatCurrency, cn } from "@/lib/utils";

type CompositionInput = {
  cogs: number;
  frete_unitario: number;
  marketing_unitario: number;
  rateio_fixo: number;
  taxas_comissoes_pct: number;
  impostos_pct: number;
  margem_alvo_pct: number;
};

type CompositionOutput = {
  custos_variaveis: number;
  preco_minimo: number;
  preco_alvo: number;
  margem_atual_brl: number | null;
  margem_atual_pct: number | null;
  status: "ok" | "abaixo_minimo" | "abaixo_alvo" | "acima_alvo";
};

type LastSnapshot = {
  id: string;
  evento: string;
  status: string;
  status_reason: string | null;
  preco_de: number;                       // MSRP (preço cheio)
  preco_por_anterior: number | null;      // sale_price atual antes da decisão
  preco_por: number;                      // preço novo sugerido pelo engine
  desconto_pct: number;
  margem_pct: number | null;
  idade_dias: number;
  cobertura_dias: number | null;
  stock_units: number;
  vendas_dia_unidades: number;
  snapshot_date: string;
  rule_applied: Record<string, unknown>;
};

type SkuResponse = {
  sku: string;
  product: {
    product_id: string;
    name: string;
    category: string | null;
    preco_de: number;
    preco_por: number;
    image_url: string | null;
    in_stock: boolean;
    created_at: string;
  } | null;
  composition: CompositionInput;
  composition_persisted: boolean;
  calc: CompositionOutput;
  last_snapshot: LastSnapshot | null;
  cost_source: "tracked" | "category_avg" | "estimated";
};

const FIELDS_BRL: Array<{ key: keyof CompositionInput; label: string; hint?: string }> = [
  { key: "cogs", label: "CMV (custo do produto)", hint: "Custo unitário em R$" },
  { key: "frete_unitario", label: "Frete unitário", hint: "Frete absorvido por unidade" },
  { key: "marketing_unitario", label: "Marketing unitário", hint: "CAC rateado por unidade" },
  { key: "rateio_fixo", label: "Rateio de despesa fixa", hint: "Aluguel/folha/sistemas rateados" },
];

const FIELDS_PCT: Array<{ key: keyof CompositionInput; label: string; hint?: string }> = [
  { key: "taxas_comissoes_pct", label: "Taxas e comissões", hint: "Gateway, marketplace, cartão" },
  { key: "impostos_pct", label: "Impostos", hint: "PIS/COFINS/ICMS efetivo" },
  { key: "margem_alvo_pct", label: "Margem alvo", hint: "Margem desejada pelo gestor" },
];

export default function SkuPricingPage() {
  const params = useParams<{ sku: string }>();
  const skuId = decodeURIComponent(params.sku);
  const { workspace } = useWorkspace();

  const [data, setData] = useState<SkuResponse | null>(null);
  const [history, setHistory] = useState<
    Array<{
      snapshot_date: string;
      idade_dias: number;
      cobertura_dias: number | null;
      preco_de: number;
      preco_por: number;
      margem_pct: number | null;
      evento: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [composition, setComposition] = useState<CompositionInput>({
    cogs: 0,
    frete_unitario: 0,
    marketing_unitario: 0,
    rateio_fixo: 0,
    taxas_comissoes_pct: 0,
    impostos_pct: 0,
    margem_alvo_pct: 0,
  });
  const [preview, setPreview] = useState<CompositionOutput | null>(null);

  const load = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pricing/sku/${encodeURIComponent(skuId)}`, {
        headers: { "x-workspace-id": workspace.id },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Falha ao carregar SKU");
        setData(null);
        return;
      }
      setData(json);
      setComposition(json.composition);
      setPreview(json.calc);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }, [skuId, workspace?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!workspace?.id) return;
    let cancelled = false;
    async function fetchHistory() {
      try {
        const res = await fetch(
          `/api/pricing/sku/${encodeURIComponent(skuId)}/history?days=90`,
          { headers: { "x-workspace-id": workspace!.id } }
        );
        const json = await res.json();
        if (!cancelled && res.ok) setHistory(json.items ?? []);
      } catch {}
    }
    fetchHistory();
    return () => {
      cancelled = true;
    };
  }, [skuId, workspace?.id]);

  // Live preview via dry-run
  useEffect(() => {
    if (!workspace?.id || !data?.product) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/pricing/composition", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-workspace-id": workspace.id },
          body: JSON.stringify({
            ...composition,
            preco_praticado: data.product?.preco_por,
          }),
        });
        const json = await res.json();
        if (!cancelled && res.ok) setPreview(json.calc);
      } catch {}
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [composition, data?.product, workspace?.id]);

  async function save() {
    if (!workspace?.id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/pricing/sku/${encodeURIComponent(skuId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspace.id },
        body: JSON.stringify(composition),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || "Falha ao salvar");
      else await load();
    } finally {
      setSaving(false);
    }
  }

  async function approveDecision(action: "approve" | "reject") {
    if (!workspace?.id || !data?.last_snapshot) return;
    setSaving(true);
    try {
      const res = await fetch("/api/pricing/engine/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspace.id },
        body: JSON.stringify({ ids: [data.last_snapshot.id], action }),
      });
      if (res.ok) await load();
    } finally {
      setSaving(false);
    }
  }

  async function applyOne() {
    if (!workspace?.id || !data?.last_snapshot) return;
    setSaving(true);
    try {
      const res = await fetch("/api/pricing/engine/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspace.id },
        body: JSON.stringify({ ids: [data.last_snapshot.id] }),
      });
      const json = await res.json();
      alert(
        json.queued
          ? "Aplicacao enfileirada para o worker. A VNDA sera atualizada em instantes."
          : `Aplicado: ${json.applied ?? 0} · Falhas: ${json.failed ?? 0}${
              json.items?.[0]?.message ? `\n${json.items[0].message}` : ""
            }`
      );
      await load();
    } finally {
      setSaving(false);
    }
  }

  const breakdownPct = useMemo(() => {
    if (!preview || !data?.product) return null;
    const preco = data.product.preco_por;
    if (preco <= 0) return null;
    const impostos_brl = preco * composition.impostos_pct;
    const taxas_brl = preco * composition.taxas_comissoes_pct;
    const margem = preview.margem_atual_brl ?? 0;
    return {
      cogs: { brl: composition.cogs, pct: (composition.cogs / preco) * 100 },
      frete: { brl: composition.frete_unitario, pct: (composition.frete_unitario / preco) * 100 },
      marketing: {
        brl: composition.marketing_unitario,
        pct: (composition.marketing_unitario / preco) * 100,
      },
      rateio: { brl: composition.rateio_fixo, pct: (composition.rateio_fixo / preco) * 100 },
      impostos: { brl: impostos_brl, pct: (impostos_brl / preco) * 100 },
      taxas: { brl: taxas_brl, pct: (taxas_brl / preco) * 100 },
      margem: { brl: margem, pct: (margem / preco) * 100 },
    };
  }, [preview, data?.product, composition]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-destructive">
          {error ?? "SKU não encontrado"}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header simples */}
      <div className="flex items-center gap-3">
        <Link href="/pricing/decisoes">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Decisões
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold">
              {data.product?.name ?? skuId}
            </h1>
            {data.product?.category && (
              <Badge variant="outline" className="text-[10px]">
                {data.product.category}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">SKU {skuId}</p>
        </div>
      </div>

      {/* HERO: Decisão recomendada (se existe) */}
      {data.last_snapshot && (
        <DecisionHero
          snapshot={data.last_snapshot}
          onApprove={() => approveDecision("approve")}
          onReject={() => approveDecision("reject")}
          onApply={applyOne}
          busy={saving}
        />
      )}

      {/* TABS — composição / histórico / análise */}
      <Tabs defaultValue="composicao">
        <TabsList>
          <TabsTrigger value="composicao">Composição de preço</TabsTrigger>
          <TabsTrigger value="historico">Histórico (90d)</TabsTrigger>
          <TabsTrigger value="snapshot">Snapshot atual</TabsTrigger>
        </TabsList>

        {/* TAB 1 — Composição */}
        <TabsContent value="composicao" className="space-y-4">
          {data.cost_source === "category_avg" && (
            <div className="rounded-md border border-blue-300 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
              CMV automático pela média da categoria
              {data.product?.category ? ` "${data.product.category}"` : ""}. Edite
              abaixo pra fixar manualmente.
            </div>
          )}
          {data.cost_source === "estimated" && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              CMV estimado via product_cost_pct global — categoria não tem outros
              SKUs com custo cadastrado.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Inputs */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  Inputs
                  <Button onClick={save} disabled={saving} size="sm" className="gap-1">
                    {saving ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3" />
                    )}
                    Salvar
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {FIELDS_BRL.map((f) => (
                    <div key={f.key} className="space-y-1">
                      <Label className="text-xs">{f.label}</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={composition[f.key]}
                        onChange={(e) =>
                          setComposition((c) => ({
                            ...c,
                            [f.key]: Number(e.target.value),
                          }))
                        }
                      />
                      {f.hint && (
                        <div className="text-[10px] text-muted-foreground">
                          {f.hint}
                        </div>
                      )}
                    </div>
                  ))}
                  {FIELDS_PCT.map((f) => (
                    <div key={f.key} className="space-y-1">
                      <Label className="text-xs">{f.label} (%)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={(composition[f.key] * 100).toFixed(2)}
                        onChange={(e) =>
                          setComposition((c) => ({
                            ...c,
                            [f.key]: Number(e.target.value) / 100,
                          }))
                        }
                      />
                      {f.hint && (
                        <div className="text-[10px] text-muted-foreground">
                          {f.hint}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Preços calculados */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Preços calculados</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row
                  label="Preço cheio"
                  value={data.product ? formatCurrency(data.product.preco_de) : "—"}
                />
                <Row
                  label="Preço praticado"
                  value={data.product ? formatCurrency(data.product.preco_por) : "—"}
                  emphasize
                />
                <div className="border-t" />
                <Row
                  label="Preço mínimo"
                  value={
                    preview && Number.isFinite(preview.preco_minimo)
                      ? formatCurrency(preview.preco_minimo)
                      : "—"
                  }
                  hint="break-even"
                />
                <Row
                  label="Preço alvo"
                  value={
                    preview && Number.isFinite(preview.preco_alvo)
                      ? formatCurrency(preview.preco_alvo)
                      : "—"
                  }
                  hint="atinge margem alvo"
                />
                <div className="border-t" />
                <Row
                  label="Margem atual"
                  value={
                    preview?.margem_atual_brl != null
                      ? `${formatCurrency(preview.margem_atual_brl)} (${((preview.margem_atual_pct ?? 0) * 100).toFixed(1)}%)`
                      : "—"
                  }
                />
                <CompositionStatus status={preview?.status} />
              </CardContent>
            </Card>
          </div>

          {/* Breakdown empilhado */}
          {breakdownPct && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Para onde vai cada real do preço praticado
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex h-10 w-full overflow-hidden rounded-md border">
                  <Layer label="CMV" pct={breakdownPct.cogs.pct} color="#ef4444" />
                  <Layer label="Frete" pct={breakdownPct.frete.pct} color="#f97316" />
                  <Layer label="Mkt" pct={breakdownPct.marketing.pct} color="#f59e0b" />
                  <Layer label="Fixo" pct={breakdownPct.rateio.pct} color="#eab308" />
                  <Layer label="Impostos" pct={breakdownPct.impostos.pct} color="#84cc16" />
                  <Layer label="Taxas" pct={breakdownPct.taxas.pct} color="#22c55e" />
                  <Layer
                    label="Margem"
                    pct={Math.max(0, breakdownPct.margem.pct)}
                    color="#10b981"
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                  <LegendItem color="#ef4444" label="CMV" v={breakdownPct.cogs} />
                  <LegendItem color="#f97316" label="Frete" v={breakdownPct.frete} />
                  <LegendItem color="#f59e0b" label="Marketing" v={breakdownPct.marketing} />
                  <LegendItem color="#eab308" label="Rateio fixo" v={breakdownPct.rateio} />
                  <LegendItem color="#84cc16" label="Impostos" v={breakdownPct.impostos} />
                  <LegendItem color="#22c55e" label="Taxas" v={breakdownPct.taxas} />
                  <LegendItem color="#10b981" label="Margem" v={breakdownPct.margem} />
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* TAB 2 — Histórico */}
        <TabsContent value="historico">
          {history.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Sem histórico ainda. Engine ainda não rodou pra este SKU em ciclos
                anteriores.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={history.map((h) => ({
                        date: h.snapshot_date,
                        preco_de: Number(h.preco_de),
                        preco_por: Number(h.preco_por),
                        margem_pct: h.margem_pct != null ? Number(h.margem_pct) * 100 : null,
                        idade: h.idade_dias,
                        cobertura: h.cobertura_dias,
                      }))}
                      margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Legend />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="preco_de"
                        stroke="#94a3b8"
                        strokeWidth={2}
                        dot={false}
                        name="Preço de"
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="preco_por"
                        stroke="#0ea5e9"
                        strokeWidth={2}
                        dot={false}
                        name="Preço por"
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="margem_pct"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={false}
                        name="Margem %"
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="idade"
                        stroke="#f59e0b"
                        strokeWidth={1}
                        strokeDasharray="4 2"
                        dot={false}
                        name="Idade (d)"
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="cobertura"
                        stroke="#ef4444"
                        strokeWidth={1}
                        strokeDasharray="4 2"
                        dot={false}
                        name="Cobertura (d)"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* TAB 3 — Snapshot atual */}
        <TabsContent value="snapshot">
          {data.last_snapshot ? (
            <SnapshotDetail snapshot={data.last_snapshot} />
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Nenhum snapshot do engine ainda pra este SKU.
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DecisionHero({
  snapshot,
  onApprove,
  onReject,
  onApply,
  busy,
}: {
  snapshot: LastSnapshot;
  onApprove: () => void;
  onReject: () => void;
  onApply: () => void;
  busy: boolean;
}) {
  const rule = snapshot.rule_applied as {
    trava_margem_minima_pct?: number;
    modo?: string;
  };
  const trava = Number(rule?.trava_margem_minima_pct ?? 0.1);
  // Delta vs preço atualmente praticado (sale_price), não MSRP. Fallback p/ MSRP
  // em snapshots antigos antes da migration 083.
  const precoAtual = snapshot.preco_por_anterior ?? snapshot.preco_de;
  const delta = precoAtual > 0 ? (snapshot.preco_por - precoAtual) / precoAtual : 0;
  const deltaPct = delta * 100;
  const hasMsrpAcima = snapshot.preco_de > precoAtual * 1.01;

  const isPending = snapshot.status === "pending";
  const isApproved = snapshot.status === "approved";
  const isApplied = snapshot.status === "applied";
  const isHold = snapshot.evento === "baseline" || snapshot.evento === "hold";

  // Health zone
  let zone: "green" | "yellow" | "red" | "neutral" = "neutral";
  if (snapshot.margem_pct != null && !isHold) {
    if (snapshot.margem_pct >= trava + 0.1) zone = "green";
    else if (snapshot.margem_pct >= trava) zone = "yellow";
    else zone = "red";
  }

  const zoneCard = {
    green: "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950",
    yellow: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950",
    red: "border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950",
    neutral: "border-muted",
  }[zone];

  const headline = isHold
    ? "Sem ação recomendada hoje"
    : snapshot.evento === "markdown"
      ? "Markdown recomendado"
      : snapshot.evento === "markup"
        ? "Markup recomendado"
        : `Ação: ${snapshot.evento}`;

  return (
    <Card className={cn("border-2", zoneCard)}>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {isHold ? null : snapshot.evento === "markdown" ? (
                <TrendingDown className="h-3 w-3" />
              ) : (
                <TrendingUp className="h-3 w-3" />
              )}
              Decisão · snapshot {snapshot.snapshot_date}
            </div>
            <div className="mt-1 text-xl font-semibold">{headline}</div>
            {snapshot.status_reason && (
              <div className="mt-1 text-xs text-muted-foreground">
                {snapshot.status_reason}
              </div>
            )}
          </div>
          <StatusBadge status={snapshot.status} evento={snapshot.evento} />
        </div>

        {!isHold && (
          <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Atual
            </span>
            <span className="text-base font-medium text-muted-foreground line-through">
              {formatCurrency(precoAtual)}
            </span>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Sugerido
            </span>
            <span className="text-3xl font-semibold tracking-tight">
              {formatCurrency(snapshot.preco_por)}
            </span>
            <span
              className={cn(
                "text-base font-medium",
                deltaPct < 0 ? "text-rose-600" : "text-emerald-600"
              )}
            >
              {deltaPct > 0 ? "+" : ""}
              {deltaPct.toFixed(1)}%
            </span>
            {hasMsrpAcima && (
              <span className="ml-2 text-xs text-muted-foreground">
                · MSRP {formatCurrency(snapshot.preco_de)}
              </span>
            )}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
          <Metric label="Idade" value={`${snapshot.idade_dias}d`} />
          <Metric
            label="Cobertura"
            value={
              snapshot.cobertura_dias != null ? `${snapshot.cobertura_dias}d` : "—"
            }
          />
          <Metric label="Estoque" value={String(snapshot.stock_units)} />
          <Metric
            label="Vendas/dia"
            value={snapshot.vendas_dia_unidades.toFixed(2)}
          />
          <Metric
            label="Margem nova"
            value={
              snapshot.margem_pct != null
                ? `${(snapshot.margem_pct * 100).toFixed(1)}%`
                : "—"
            }
            hint={`trava ${(trava * 100).toFixed(0)}%`}
            tone={
              zone === "green"
                ? "good"
                : zone === "red"
                  ? "bad"
                  : zone === "yellow"
                    ? "warn"
                    : undefined
            }
          />
        </div>

        {isPending && !isHold && (
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={onApprove} disabled={busy} className="gap-1">
              <CheckCircle2 className="h-4 w-4" /> Aprovar decisão
            </Button>
            <Button
              variant="outline"
              onClick={onReject}
              disabled={busy}
              className="gap-1"
            >
              <XCircle className="h-4 w-4" /> Rejeitar
            </Button>
          </div>
        )}
        {isApproved && (
          <div className="mt-5">
            <Button
              onClick={onApply}
              disabled={busy}
              className="gap-1 bg-emerald-600 hover:bg-emerald-700"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Aplicar agora na VNDA
            </Button>
          </div>
        )}
        {isApplied && (
          <div className="mt-5 flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> Já aplicado na VNDA
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({
  status,
  evento,
}: {
  status: string;
  evento: string;
}) {
  if (evento === "baseline" || evento === "hold") {
    return <Badge variant="outline">Sem ação</Badge>;
  }
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pendente", cls: "bg-amber-100 text-amber-900 hover:bg-amber-100" },
    approved: { label: "Aprovado", cls: "bg-blue-100 text-blue-900 hover:bg-blue-100" },
    applied: { label: "Aplicado", cls: "bg-emerald-100 text-emerald-900 hover:bg-emerald-100" },
    rejected: { label: "Rejeitado", cls: "bg-muted text-muted-foreground" },
    skipped: { label: "Skip", cls: "bg-muted text-muted-foreground" },
  };
  const m = map[status] ?? { label: status, cls: "" };
  return <Badge className={m.cls}>{m.label}</Badge>;
}

function SnapshotDetail({ snapshot }: { snapshot: LastSnapshot }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Detalhe do snapshot</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs">
          {JSON.stringify(snapshot, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  emphasize,
  hint,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <div>
        <span className="text-sm text-muted-foreground">{label}</span>
        {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
      </div>
      <span className={emphasize ? "text-base font-semibold" : "text-sm font-medium"}>
        {value}
      </span>
    </div>
  );
}

function CompositionStatus({ status }: { status?: CompositionOutput["status"] }) {
  if (!status) return null;
  if (status === "acima_alvo")
    return (
      <Badge className="gap-1 bg-emerald-100 text-emerald-900 hover:bg-emerald-100">
        <CheckCircle2 className="h-3 w-3" /> Acima da margem alvo
      </Badge>
    );
  if (status === "abaixo_alvo")
    return (
      <Badge className="gap-1 bg-amber-100 text-amber-900 hover:bg-amber-100">
        <AlertTriangle className="h-3 w-3" /> Entre mínimo e alvo
      </Badge>
    );
  if (status === "abaixo_minimo")
    return (
      <Badge className="gap-1 bg-rose-100 text-rose-900 hover:bg-rose-100">
        <XCircle className="h-3 w-3" /> Abaixo do mínimo
      </Badge>
    );
  return null;
}

function Layer({ label, pct, color }: { label: string; pct: number; color: string }) {
  if (pct <= 0) return null;
  return (
    <div
      title={`${label}: ${pct.toFixed(1)}%`}
      style={{ width: `${Math.max(0, pct)}%`, background: color }}
      className="flex items-center justify-center text-[10px] font-medium text-white"
    >
      {pct >= 6 ? `${pct.toFixed(0)}%` : ""}
    </div>
  );
}

function LegendItem({
  color,
  label,
  v,
}: {
  color: string;
  label: string;
  v: { brl: number; pct: number };
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-3 w-3 rounded-sm" style={{ background: color }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-medium">
        {formatCurrency(v.brl)} · {v.pct.toFixed(1)}%
      </span>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "text-base font-medium",
          tone === "good" && "text-emerald-600",
          tone === "warn" && "text-amber-600",
          tone === "bad" && "text-rose-600"
        )}
      >
        {value}
      </div>
      {hint && (
        <div className="text-[10px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}
