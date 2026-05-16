"use client";

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
import { useWorkspace } from "@/lib/workspace-context";
import { formatCurrency } from "@/lib/utils";

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
      desconto_pct: number;
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
      if (!res.ok) {
        setError(json.error || "Falha ao salvar");
      } else {
        await load();
      }
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
    const total = preco;
    return {
      cogs: { brl: composition.cogs, pct: (composition.cogs / total) * 100 },
      frete: { brl: composition.frete_unitario, pct: (composition.frete_unitario / total) * 100 },
      marketing: {
        brl: composition.marketing_unitario,
        pct: (composition.marketing_unitario / total) * 100,
      },
      rateio: { brl: composition.rateio_fixo, pct: (composition.rateio_fixo / total) * 100 },
      impostos: { brl: impostos_brl, pct: (impostos_brl / total) * 100 },
      taxas: { brl: taxas_brl, pct: (taxas_brl / total) * 100 },
      margem: { brl: margem, pct: (margem / total) * 100 },
    };
  }, [preview, data?.product, composition]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-destructive">{error}</CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link href="/pricing">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">
            {data.product?.name ?? skuId}
          </h1>
          <p className="text-xs text-muted-foreground">
            SKU {skuId}
            {data.product?.category ? ` · ${data.product.category}` : ""}
          </p>
        </div>
        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar composição
        </Button>
      </div>

      {data.cost_source === "category_avg" && (
        <Card className="border-blue-300 bg-blue-50 dark:border-blue-900 dark:bg-blue-950">
          <CardContent className="flex items-start gap-3 py-3 text-sm text-blue-900 dark:text-blue-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              CMV calculado automaticamente pela média da categoria
              {data.product?.category ? ` "${data.product.category}"` : ""}. Vai virar
              persistido se você clicar em "Salvar composição" — ou edite o valor
              abaixo pra override manual.
            </div>
          </CardContent>
        </Card>
      )}
      {data.cost_source === "estimated" && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
          <CardContent className="flex items-start gap-3 py-3 text-sm text-amber-900 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              CMV estimado via product_cost_pct global — sem outros SKUs da mesma
              categoria pra calcular média. Cadastre o custo real ou importe o CSV
              em /pricing/config.
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Composição de preço</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {FIELDS_BRL.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label className="text-xs">{f.label}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={composition[f.key]}
                    onChange={(e) =>
                      setComposition((c) => ({ ...c, [f.key]: Number(e.target.value) }))
                    }
                  />
                  {f.hint && (
                    <div className="text-[10px] text-muted-foreground">{f.hint}</div>
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
                    <div className="text-[10px] text-muted-foreground">{f.hint}</div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Preços calculados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Row
              label="Preço cheio (de)"
              value={data.product ? formatCurrency(data.product.preco_de) : "—"}
            />
            <Row
              label="Preço praticado (por)"
              value={data.product ? formatCurrency(data.product.preco_por) : "—"}
              emphasize
            />
            <div className="my-2 border-t" />
            <Row
              label="Preço mínimo (break-even)"
              value={
                preview && Number.isFinite(preview.preco_minimo)
                  ? formatCurrency(preview.preco_minimo)
                  : "—"
              }
            />
            <Row
              label="Preço alvo (margem alvo)"
              value={
                preview && Number.isFinite(preview.preco_alvo)
                  ? formatCurrency(preview.preco_alvo)
                  : "—"
              }
            />
            <div className="my-2 border-t" />
            <Row
              label="Margem atual"
              value={
                preview?.margem_atual_brl != null
                  ? `${formatCurrency(preview.margem_atual_brl)} (${((preview.margem_atual_pct ?? 0) * 100).toFixed(1)}%)`
                  : "—"
              }
            />
            <div className="pt-2">
              <StatusBadge status={preview?.status} />
            </div>
          </CardContent>
        </Card>
      </div>

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Histórico (90 dias)</CardTitle>
          </CardHeader>
          <CardContent>
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
                    name="Idade (dias)"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="cobertura"
                    stroke="#ef4444"
                    strokeWidth={1}
                    strokeDasharray="4 2"
                    dot={false}
                    name="Cobertura (dias)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {breakdownPct && (
        <Card>
          <CardHeader>
            <CardTitle>Decomposição do preço praticado</CardTitle>
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
    </div>
  );
}

function Row({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={emphasize ? "text-base font-semibold" : "text-sm font-medium"}>
        {value}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status?: CompositionOutput["status"] }) {
  if (!status) return null;
  if (status === "acima_alvo") {
    return (
      <Badge className="gap-1 bg-emerald-100 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-900 dark:text-emerald-100">
        <CheckCircle2 className="h-3 w-3" /> Acima da margem alvo
      </Badge>
    );
  }
  if (status === "abaixo_alvo") {
    return (
      <Badge className="gap-1 bg-amber-100 text-amber-900 hover:bg-amber-100 dark:bg-amber-900 dark:text-amber-100">
        <AlertTriangle className="h-3 w-3" /> Entre mínimo e alvo
      </Badge>
    );
  }
  if (status === "abaixo_minimo") {
    return (
      <Badge className="gap-1 bg-rose-100 text-rose-900 hover:bg-rose-100 dark:bg-rose-900 dark:text-rose-100">
        <XCircle className="h-3 w-3" /> Abaixo do mínimo (prejuízo)
      </Badge>
    );
  }
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
