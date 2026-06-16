"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, Package, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace-context";
import { formatCurrency } from "@/lib/utils";

type SkuItem = {
  sku: string;
  product_id: string;
  name: string;
  category: string | null;
  preco_de: number;
  preco_por: number;
  desconto_pct: number;
  image_url: string | null;
  in_stock: boolean;
  created_at: string;
  has_pricing: boolean;
  has_manual_composition?: boolean;
  cogs_tracked: boolean;
  cogs: number | null;
  preco_minimo_calc: number | null;
  preco_alvo_calc: number | null;
  margem_alvo_pct: number | null;
};

type StatusFilter = "all" | "configured" | "pending";

type SkuSummary = {
  total_matching: number;
  configured_matching: number;
  manual_composition_matching: number;
  cogs_tracked_matching: number;
};

export default function PricingLandingPage() {
  const { workspace } = useWorkspace();
  const [items, setItems] = useState<SkuItem[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [apiSummary, setApiSummary] = useState<SkuSummary | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!workspace?.id) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          status,
          limit: "30",
          ...(debouncedQuery ? { q: debouncedQuery } : {}),
        });
        const res = await fetch(`/api/pricing/skus?${params}`, {
          headers: { "x-workspace-id": workspace!.id },
        });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setItems(data.items ?? []);
          setCount(data.count ?? 0);
          setApiSummary(data.summary ?? null);
        } else {
          setItems([]);
          setCount(0);
          setApiSummary(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [workspace?.id, debouncedQuery, status]);

  const summary = useMemo(() => {
    if (apiSummary) {
      return {
        configured: apiSummary.configured_matching,
        tracked: apiSummary.cogs_tracked_matching,
        manual: apiSummary.manual_composition_matching,
        total: apiSummary.total_matching,
      };
    }
    const configured = items.filter((i) => i.has_pricing).length;
    const tracked = items.filter((i) => i.cogs_tracked).length;
    const manual = items.filter((i) => i.has_manual_composition).length;
    return { configured, tracked, manual, total: items.length };
  }, [apiSummary, items]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Pricing</h1>
        <p className="text-sm text-muted-foreground">
            Composicao de preco por SKU, engine de markdown/markup e simulador de elasticidade.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">SKUs prontos para pricing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{summary.configured}</div>
            <div className="text-xs text-muted-foreground">
              de {summary.total} no filtro ({count} listados)
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">SKUs com CMV trackeado</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{summary.tracked}</div>
            <div className="text-xs text-muted-foreground">
              via product_costs · {summary.manual} com composição manual
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Cobertura</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {summary.total > 0 ? Math.round((summary.configured / summary.total) * 100) : 0}%
            </div>
            <div className="text-xs text-muted-foreground">SKUs prontos para o engine</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>SKUs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full md:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar SKU, nome ou product_id"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              {(["all", "configured", "pending"] as StatusFilter[]).map((s) => (
                <Button
                  key={s}
                  variant={status === s ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatus(s)}
                >
                  {s === "all" ? "Todos" : s === "configured" ? "Configurados" : "Pendentes"}
                </Button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nenhum SKU encontrado.
            </div>
          ) : (
            <div className="divide-y rounded-md border">
              {items.map((item) => (
                <Link
                  key={item.sku}
                  href={`/pricing/sku/${encodeURIComponent(item.sku)}`}
                  className="flex items-center gap-3 p-3 transition hover:bg-muted/50"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" />
                    ) : (
                      <Package className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{item.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {item.sku} {item.category ? `· ${item.category}` : ""}
                    </div>
                  </div>
                  <div className="hidden flex-col items-end text-right text-xs md:flex">
                    <div className="text-sm font-medium">{formatCurrency(item.preco_por)}</div>
                    {item.desconto_pct > 0 && (
                      <div className="text-xs text-muted-foreground line-through">
                        {formatCurrency(item.preco_de)}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {item.has_pricing ? (
                      <Badge variant="default" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Pronto
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <AlertTriangle className="h-3 w-3" /> Pendente
                      </Badge>
                    )}
                    {!item.cogs_tracked && (
                      <Badge variant="outline" className="text-[10px]">
                        Sem CMV direto
                      </Badge>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
