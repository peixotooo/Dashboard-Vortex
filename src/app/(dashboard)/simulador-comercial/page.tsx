"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  Tag,
  Truck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Package,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/lib/workspace-context";
import { formatCurrency } from "@/lib/utils";
import { simulate } from "@/lib/commercial-simulator/calculate";
import { GATILHOS, type SkuLookup } from "@/lib/commercial-simulator/types";

type Settings = {
  piso_margem_pct: number;
  buffer_zona_verde_pct: number;
  custo_frete_medio_brl: number;
  ticket_minimo_frete_gratis_brl: number;
  product_cost_pct: number;
  tax_pct: number;
  other_expenses_pct: number;
  isDefault: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  piso_margem_pct: 15,
  buffer_zona_verde_pct: 5,
  custo_frete_medio_brl: 25,
  ticket_minimo_frete_gratis_brl: 199,
  product_cost_pct: 25,
  tax_pct: 6,
  other_expenses_pct: 5,
  isDefault: true,
};

export default function CommercialSimulatorPage() {
  const { workspace } = useWorkspace();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [sku, setSku] = useState<SkuLookup | null>(null);

  const [descontoPct, setDescontoPct] = useState(0);
  const [freteGratis, setFreteGratis] = useState(false);
  const [custoFreteOverride, setCustoFreteOverride] = useState<number | null>(null);
  const [gatilho, setGatilho] = useState<string>("");
  const [gatilhoOutro, setGatilhoOutro] = useState("");

  useEffect(() => {
    if (!workspace?.id) return;
    async function fetchSettings() {
      try {
        const res = await fetch("/api/simulador-comercial/settings", {
          headers: { "x-workspace-id": workspace!.id },
        });
        const data = await res.json();
        setSettings(data);
      } catch {
        setSettings(DEFAULT_SETTINGS);
      } finally {
        setSettingsLoaded(true);
      }
    }
    fetchSettings();
  }, [workspace?.id]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!workspace?.id || !searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `/api/simulador-comercial/sku/${encodeURIComponent(searchQuery.trim())}`,
        { headers: { "x-workspace-id": workspace.id } }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSearchError(data.error ?? `Erro ${res.status}`);
        setSku(null);
      } else {
        const data: SkuLookup = await res.json();
        setSku(data);
        setDescontoPct(0);
        setFreteGratis(false);
        setCustoFreteOverride(null);
        setGatilho("");
        setGatilhoOutro("");
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Erro desconhecido");
      setSku(null);
    } finally {
      setSearching(false);
    }
  }

  const custoFreteAtual = custoFreteOverride ?? settings.custo_frete_medio_brl;

  const result = useMemo(() => {
    if (!sku) return null;
    return simulate({
      precoCheio: sku.precoCheio,
      descontoPct,
      freteGratis,
      custoProdutoPct: settings.product_cost_pct,
      taxPct: settings.tax_pct,
      outrasDespesasPct: settings.other_expenses_pct,
      custoFreteMedioBrl: custoFreteAtual,
      pisoMargemPct: settings.piso_margem_pct,
      bufferZonaVerdePct: settings.buffer_zona_verde_pct,
    });
  }, [sku, descontoPct, freteGratis, custoFreteAtual, settings]);

  const margemBase = useMemo(() => {
    if (!sku) return null;
    return simulate({
      precoCheio: sku.precoCheio,
      descontoPct: 0,
      freteGratis: false,
      custoProdutoPct: settings.product_cost_pct,
      taxPct: settings.tax_pct,
      outrasDespesasPct: settings.other_expenses_pct,
      custoFreteMedioBrl: custoFreteAtual,
      pisoMargemPct: settings.piso_margem_pct,
      bufferZonaVerdePct: settings.buffer_zona_verde_pct,
    });
  }, [sku, custoFreteAtual, settings]);

  const podeAplicar =
    result &&
    (result.veredicto === "verde" ||
      (result.veredicto === "amarelo" && gatilho && (gatilho !== "outro" || gatilhoOutro.trim().length > 0)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Tag className="h-6 w-6 text-primary" />
          Simulador Comercial
        </h1>
        <p className="text-sm text-muted-foreground">
          Decida em tempo real se um desconto cabe na margem. Verde, amarela ou vermelha — com texto que explica o porquê.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Digite o SKU ou código do produto"
                className="w-full pl-10 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={searching || !searchQuery.trim()}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Buscar
            </button>
          </form>
          {searchError && (
            <p className="mt-3 text-sm text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" />
              {searchError}
            </p>
          )}
          {settings.isDefault && settingsLoaded && (
            <p className="mt-3 text-xs text-muted-foreground">
              Usando configurações padrão. Owner/admin pode personalizar em{" "}
              <a href="/simulador-comercial/config" className="underline hover:text-primary">
                Configurações
              </a>
              .
            </p>
          )}
        </CardContent>
      </Card>

      {sku && result && margemBase && (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                {sku.imagem ? (
                  <div className="w-24 h-24 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={sku.imagem}
                      alt={sku.nome}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-24 h-24 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                    <Package className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">{sku.codigo}</p>
                  <h2 className="text-lg font-semibold truncate">{sku.nome}</h2>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm">
                    {sku.categoria && (
                      <span className="text-muted-foreground">
                        Categoria: <strong className="text-foreground">{sku.categoria}</strong>
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      Preço cheio: <strong className="text-foreground">{formatCurrency(sku.precoCheio)}</strong>
                    </span>
                    {sku.estoque != null && (
                      <span className="text-muted-foreground">
                        Estoque: <strong className="text-foreground">{sku.estoque} un.</strong>
                      </span>
                    )}
                    {!sku.inStock && (
                      <span className="text-warning">Indisponível na loja</span>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  Alavancas
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm font-medium">Desconto direto</label>
                    <span className="text-sm font-mono">{descontoPct.toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={70}
                    step={1}
                    value={descontoPct}
                    onChange={(e) => setDescontoPct(parseInt(e.target.value, 10))}
                    className="w-full accent-primary"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Aplicado sobre o preço cheio. {formatCurrency(result.descontoBrl)} de desconto.
                  </p>
                </div>

                <div className="border-t border-border pt-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4" />
                      <span className="text-sm font-medium">Frete grátis</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFreteGratis(!freteGratis)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        freteGratis ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          freteGratis ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                  {freteGratis && (
                    <div className="pl-6 space-y-1">
                      <label className="text-xs text-muted-foreground">Custo médio absorvido</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          R$
                        </span>
                        <input
                          type="number"
                          value={custoFreteAtual}
                          onChange={(e) => setCustoFreteOverride(parseFloat(e.target.value) || 0)}
                          step={1}
                          className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-border bg-background text-sm"
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground/60">
                        Padrão {formatCurrency(settings.custo_frete_medio_brl)} (vem da config). Ticket mínimo
                        sugerido: {formatCurrency(settings.ticket_minimo_frete_gratis_brl)}.
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Composição de custo</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <Row label="Preço cheio" value={formatCurrency(sku.precoCheio)} />
                  <Row
                    label={`Desconto (${descontoPct}%)`}
                    value={`− ${formatCurrency(result.descontoBrl)}`}
                    muted
                  />
                  <Row label="Preço líquido" value={formatCurrency(result.precoLiquido)} bold />
                  <div className="border-t border-border my-2" />
                  <Row
                    label={`CMV (${settings.product_cost_pct}%)`}
                    value={`− ${formatCurrency(result.cmvBrl)}`}
                    muted
                  />
                  <Row
                    label={`Impostos (${settings.tax_pct}%)`}
                    value={`− ${formatCurrency(result.impostosBrl)}`}
                    muted
                  />
                  <Row
                    label={`Outras despesas (${settings.other_expenses_pct}%)`}
                    value={`− ${formatCurrency(result.outrosBrl)}`}
                    muted
                  />
                  <Row
                    label="Frete absorvido"
                    value={
                      freteGratis ? `− ${formatCurrency(result.freteAbsorvidoBrl)}` : "—"
                    }
                    muted
                  />
                  <Row label="Custo total" value={formatCurrency(result.custoTotal)} bold />
                  <div className="border-t border-border my-2" />
                  <Row label={`Piso (${settings.piso_margem_pct}%)`} value="Mínimo aceitável" muted />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiBox
              label="Preço líquido"
              value={formatCurrency(result.precoLiquido)}
              delta={result.precoLiquido - sku.precoCheio}
              deltaFormat="currency"
            />
            <KpiBox
              label="Margem por venda"
              value={formatCurrency(result.margemBrl)}
              delta={result.margemBrl - margemBase.margemBrl}
              deltaFormat="currency"
              big
            />
            <KpiBox
              label="Margem %"
              value={`${result.margemPct.toFixed(1)}%`}
              delta={result.margemPct - margemBase.margemPct}
              deltaFormat="pp"
            />
            <KpiBox
              label="Ticket"
              value={formatCurrency(result.precoLiquido)}
              delta={result.precoLiquido - sku.precoCheio}
              deltaFormat="currency"
            />
          </div>

          <VeredictoCard
            veredicto={result.veredicto}
            explicacao={result.explicacao}
            sugestoes={result.sugestoes}
            gatilho={gatilho}
            setGatilho={setGatilho}
            gatilhoOutro={gatilhoOutro}
            setGatilhoOutro={setGatilhoOutro}
            podeAplicar={!!podeAplicar}
          />
        </>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  bold,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className={muted ? "text-muted-foreground" : ""}>{label}</span>
      <span className={`font-mono ${bold ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}

function KpiBox({
  label,
  value,
  delta,
  deltaFormat,
  big,
}: {
  label: string;
  value: string;
  delta: number;
  deltaFormat: "currency" | "pp";
  big?: boolean;
}) {
  const formatDelta = (n: number) => {
    if (Math.abs(n) < 0.01) return null;
    const sign = n > 0 ? "+" : "";
    if (deltaFormat === "currency") return `${sign}${formatCurrency(n)}`;
    return `${sign}${n.toFixed(1)} pp`;
  };
  const deltaStr = formatDelta(delta);
  const deltaColor = delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-muted-foreground";

  return (
    <Card className={big ? "border-primary/40 bg-primary/[0.03]" : ""}>
      <CardContent className="pt-5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`font-bold ${big ? "text-2xl" : "text-xl"} mt-1`}>{value}</p>
        {deltaStr && <p className={`text-xs mt-1 ${deltaColor}`}>{deltaStr} vs cheio</p>}
      </CardContent>
    </Card>
  );
}

function VeredictoCard({
  veredicto,
  explicacao,
  sugestoes,
  gatilho,
  setGatilho,
  gatilhoOutro,
  setGatilhoOutro,
  podeAplicar,
}: {
  veredicto: "verde" | "amarelo" | "vermelho";
  explicacao: string;
  sugestoes: string[];
  gatilho: string;
  setGatilho: (v: string) => void;
  gatilhoOutro: string;
  setGatilhoOutro: (v: string) => void;
  podeAplicar: boolean;
}) {
  const config = {
    verde: {
      bg: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800",
      text: "text-emerald-900 dark:text-emerald-100",
      icon: <CheckCircle2 className="h-6 w-6 text-emerald-600" />,
      label: "Verde — pode rodar livre",
    },
    amarelo: {
      bg: "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-300 dark:border-yellow-800",
      text: "text-yellow-900 dark:text-yellow-100",
      icon: <AlertTriangle className="h-6 w-6 text-yellow-600" />,
      label: "Amarela — precisa de gatilho",
    },
    vermelho: {
      bg: "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800",
      text: "text-red-900 dark:text-red-100",
      icon: <XCircle className="h-6 w-6 text-red-600" />,
      label: "Vermelha — bloqueado",
    },
  }[veredicto];

  return (
    <Card className={`border-2 ${config.bg}`}>
      <CardContent className="pt-6">
        <div className="flex items-start gap-3">
          {config.icon}
          <div className="flex-1">
            <p className={`font-semibold ${config.text}`}>{config.label}</p>
            <p className={`text-sm mt-1 ${config.text}`}>{explicacao}</p>

            {veredicto === "amarelo" && (
              <div className="mt-4 space-y-2">
                <label className={`text-xs font-medium ${config.text}`}>
                  Selecione o gatilho que justifica essa decisão *
                </label>
                <select
                  value={gatilho}
                  onChange={(e) => setGatilho(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Escolha um gatilho...</option>
                  {GATILHOS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
                {gatilho === "outro" && (
                  <input
                    type="text"
                    value={gatilhoOutro}
                    onChange={(e) => setGatilhoOutro(e.target.value)}
                    placeholder="Descreva o motivo"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                )}
              </div>
            )}

            {veredicto === "vermelho" && sugestoes.length > 0 && (
              <div className="mt-4">
                <p className={`text-xs font-medium ${config.text}`}>Caminhos pra sair do vermelho:</p>
                <ul className={`text-sm mt-1 space-y-1 ${config.text}`}>
                  {sugestoes.map((s, i) => (
                    <li key={i}>• {s}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={!podeAplicar}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  podeAplicar
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                }`}
              >
                ✓ Pode aplicar
              </button>
              {veredicto === "vermelho" && (
                <button
                  type="button"
                  disabled
                  title="Disponível em fatia futura — fluxo de aprovação"
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-muted text-muted-foreground cursor-not-allowed"
                >
                  Solicitar aprovação
                </button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
