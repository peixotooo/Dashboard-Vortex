"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Search, Loader2, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace-context";
import { formatCurrency, cn } from "@/lib/utils";
import { projectDemand } from "@/lib/pricing/elasticity";

type ProductOption = {
  codigo: string;
  nome: string;
  precoCheio: number;
  salePrice: number | null;
  imagem: string | null;
};

type ChannelElasticity = {
  channel: string;
  coefficient: number;
  is_fallback: boolean;
  points: number;
  recent_avg_price: number;
  recent_avg_qty: number;
};

type Pricing = {
  frete_unitario: number | null;
  marketing_unitario: number | null;
  rateio_fixo: number | null;
  taxas_comissoes_pct: number | null;
  impostos_pct: number | null;
};

type ElasticityResponse = {
  sku: string;
  product: { name: string; price: number; sale_price: number | null } | null;
  pricing: Pricing | null;
  channels: ChannelElasticity[];
};

type Scenario = "atual" | "alternativo" | "proposto";
const SCENARIOS: Scenario[] = ["atual", "alternativo", "proposto"];

export default function ElasticitySimulatorPage() {
  const { workspace } = useWorkspace();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [data, setData] = useState<ElasticityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [cogs, setCogs] = useState(0);
  const [scenarios, setScenarios] = useState<Record<Scenario, number>>({
    atual: 0,
    alternativo: 0,
    proposto: 0,
  });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!workspace?.id || debouncedQuery.length < 2) {
      setOptions([]);
      return;
    }
    setSearching(true);
    fetch(
      `/api/simulador-comercial/products?q=${encodeURIComponent(debouncedQuery)}&limit=10`,
      { headers: { "x-workspace-id": workspace.id } }
    )
      .then((r) => r.json())
      .then((j) => setOptions(j.items ?? []))
      .finally(() => setSearching(false));
  }, [debouncedQuery, workspace?.id]);

  useEffect(() => {
    if (!workspace?.id || !selectedSku) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/pricing/elasticity/${encodeURIComponent(selectedSku)}`, {
        headers: { "x-workspace-id": workspace.id },
      }).then((r) => r.json()),
      fetch(`/api/pricing/sku/${encodeURIComponent(selectedSku)}`, {
        headers: { "x-workspace-id": workspace.id },
      }).then((r) => r.json()),
    ])
      .then(([elasticity, skuData]) => {
        setData(elasticity);
        setCogs(Number(skuData?.composition?.cogs ?? 0));
        const precoAtual = elasticity?.product?.sale_price ?? elasticity?.product?.price ?? 0;
        setScenarios({
          atual: precoAtual,
          alternativo: precoAtual * 0.95,
          proposto: precoAtual * 0.9,
        });
      })
      .finally(() => setLoading(false));
  }, [selectedSku, workspace?.id]);

  function lucroUnitario(preco: number): number | null {
    if (!data?.pricing) return null;
    const cvar =
      cogs +
      Number(data.pricing.frete_unitario ?? 0) +
      Number(data.pricing.marketing_unitario ?? 0) +
      Number(data.pricing.rateio_fixo ?? 0);
    const impostos = preco * Number(data.pricing.impostos_pct ?? 0);
    const taxas = preco * Number(data.pricing.taxas_comissoes_pct ?? 0);
    return preco - cvar - impostos - taxas;
  }

  // Por canal, calcula demanda projetada e lucro total em cada cenário
  const byChannel = useMemo(() => {
    if (!data) return [];
    return data.channels.map((ch) => {
      const refPrice = ch.recent_avg_price > 0 ? ch.recent_avg_price : scenarios.atual;
      const refQty = ch.recent_avg_qty > 0 ? ch.recent_avg_qty : 1;
      const results = SCENARIOS.map((s) => {
        const preco = scenarios[s];
        const lucroUnit = lucroUnitario(preco);
        const demanda = projectDemand(preco, refPrice, refQty, ch.coefficient);
        const lucroTotal = lucroUnit != null ? lucroUnit * demanda : null;
        return { scenario: s, preco, demanda, lucroUnit, lucroTotal };
      });
      const vencedor = results.reduce((max, r) =>
        (r.lucroTotal ?? -Infinity) > (max.lucroTotal ?? -Infinity) ? r : max
      );
      return { channel: ch, results, vencedor };
    });
  }, [data, scenarios, cogs]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Simulador de elasticidade</h1>
        <p className="text-sm text-muted-foreground">
          Compare 3 cenários de preço por canal — o sistema escolhe o que
          maximiza lucro total (não lucro unitário).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Selecionar SKU</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar SKU, nome ou product_id"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
            {(searching || options.length > 0) && query.length >= 2 && (
              <div className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover shadow-md">
                {searching ? (
                  <div className="flex items-center justify-center py-4 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : (
                  options.map((opt) => (
                    <button
                      key={opt.codigo}
                      type="button"
                      onClick={() => {
                        setSelectedSku(opt.codigo);
                        setQuery(opt.nome);
                        setOptions([]);
                      }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <div className="font-medium">{opt.nome}</div>
                      <div className="text-xs text-muted-foreground">
                        {opt.codigo} · {formatCurrency(opt.salePrice ?? opt.precoCheio)}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Cenários de preço</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                {SCENARIOS.map((s) => (
                  <div key={s} className="space-y-1">
                    <Label className="text-xs capitalize">{s}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={scenarios[s]}
                      onChange={(e) =>
                        setScenarios((prev) => ({
                          ...prev,
                          [s]: Number(e.target.value),
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                CMV utilizado: {formatCurrency(cogs)} (vem da composição cadastrada)
              </div>
            </CardContent>
          </Card>

          {data.channels.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Sem histórico de vendas suficiente pra estimar elasticidade.
                Vendas por canal aparecem aqui depois que tiver dados.
              </CardContent>
            </Card>
          ) : (
            byChannel.map(({ channel, results, vencedor }) => (
              <Card key={channel.channel}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>Canal: {channel.channel}</span>
                    <div className="flex gap-2 text-xs">
                      <Badge variant="outline">
                        η = {channel.coefficient.toFixed(2)}
                      </Badge>
                      {channel.is_fallback && (
                        <Badge variant="outline">fallback</Badge>
                      )}
                      <Badge variant="outline">{channel.points} pontos</Badge>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground">
                        <th className="p-2 text-left">Cenário</th>
                        <th className="p-2 text-right">Preço</th>
                        <th className="p-2 text-right">Demanda esperada</th>
                        <th className="p-2 text-right">Lucro unitário</th>
                        <th className="p-2 text-right">Lucro total</th>
                        <th className="p-2 text-center">Vencedor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r) => (
                        <tr
                          key={r.scenario}
                          className={cn(
                            "border-t",
                            r === vencedor && "bg-emerald-50 dark:bg-emerald-900/30"
                          )}
                        >
                          <td className="p-2 capitalize">{r.scenario}</td>
                          <td className="p-2 text-right">{formatCurrency(r.preco)}</td>
                          <td className="p-2 text-right">{r.demanda.toFixed(1)}</td>
                          <td className="p-2 text-right">
                            {r.lucroUnit != null ? formatCurrency(r.lucroUnit) : "—"}
                          </td>
                          <td className="p-2 text-right font-medium">
                            {r.lucroTotal != null ? formatCurrency(r.lucroTotal) : "—"}
                          </td>
                          <td className="p-2 text-center">
                            {r === vencedor && (
                              <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-600" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ))
          )}
        </>
      )}
    </div>
  );
}
