"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, TrendingDown, TrendingUp, Package, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

type Kpis = {
  total_skus: number;
  skus_com_pricing: number;
  pct_estoque_ate_120d: number;
  margem_media_ponderada_pct: number;
  desconto_medio_ponderado_pct: number;
  skus_em_markdown: number;
  skus_em_markup: number;
};

type IdadeMargem = {
  label: string;
  margem_pct: number;
  desconto_pct: number;
  share_estoque_pct: number;
  share_faturamento_pct: number;
  sku_count: number;
  stock_units: number;
};

type TravaDesconto = {
  trava: "alta" | "media" | "baixa";
  desconto: "alto" | "medio" | "baixo";
  health: "green" | "yellow" | "red";
  label: string;
  sku_count: number;
  skus: string[];
};

export default function PricingVisaoGeralPage() {
  const { workspace } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [idadeMargem, setIdadeMargem] = useState<IdadeMargem[]>([]);
  const [travaDesconto, setTravaDesconto] = useState<TravaDesconto[]>([]);

  useEffect(() => {
    if (!workspace?.id) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/pricing/overview", {
          headers: { "x-workspace-id": workspace!.id },
        });
        const json = await res.json();
        if (cancelled || !res.ok) return;
        setKpis(json.kpis);
        setIdadeMargem(json.idade_margem);
        setTravaDesconto(json.trava_desconto);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [workspace?.id]);

  const metaEstoqueOk = (kpis?.pct_estoque_ate_120d ?? 0) >= 90;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!kpis) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Sem dados ainda. Rode o engine pelo menos uma vez pra popular os snapshots.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Visão geral de Pricing</h1>
        <p className="text-sm text-muted-foreground">
          KPIs, saúde de estoque por idade e matriz Trava × Desconto.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          icon={<Target className="h-4 w-4" />}
          label="% estoque ≤ 120d"
          value={`${kpis.pct_estoque_ate_120d.toFixed(0)}%`}
          hint={`Meta 90% · ${metaEstoqueOk ? "✓" : "abaixo"}`}
          tone={metaEstoqueOk ? "green" : "red"}
        />
        <Kpi
          icon={<Package className="h-4 w-4" />}
          label="Margem média ponderada"
          value={`${kpis.margem_media_ponderada_pct.toFixed(1)}%`}
        />
        <Kpi
          icon={<TrendingDown className="h-4 w-4" />}
          label="Desconto médio"
          value={`${kpis.desconto_medio_ponderado_pct.toFixed(1)}%`}
        />
        <Kpi
          icon={<TrendingUp className="h-4 w-4" />}
          label="SKUs com composição"
          value={`${kpis.skus_com_pricing}`}
          hint={`de ${kpis.total_skus} ativos`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Matriz idade × margem (Conceito 7)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="p-2 text-left">Idade (dias)</th>
                  {idadeMargem.map((b) => (
                    <th key={b.label} className="p-2 text-right">{b.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="p-2 font-medium">Margem média</td>
                  {idadeMargem.map((b) => (
                    <td key={b.label} className="p-2 text-right">
                      {b.margem_pct.toFixed(0)}%
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-2 font-medium">Desconto médio</td>
                  {idadeMargem.map((b) => (
                    <td key={b.label} className="p-2 text-right">
                      {b.desconto_pct.toFixed(0)}%
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-2 font-medium">Share de estoque</td>
                  {idadeMargem.map((b) => (
                    <td key={b.label} className={cn("p-2 text-right", b.label === "121+" && b.share_estoque_pct > 5 ? "text-rose-600" : "")}>
                      {b.share_estoque_pct.toFixed(0)}%
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-2 font-medium">Share de faturamento</td>
                  {idadeMargem.map((b) => (
                    <td key={b.label} className="p-2 text-right">
                      {b.share_faturamento_pct.toFixed(0)}%
                    </td>
                  ))}
                </tr>
                <tr className="text-muted-foreground">
                  <td className="p-2">SKUs</td>
                  {idadeMargem.map((b) => (
                    <td key={b.label} className="p-2 text-right">{b.sku_count}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Matriz Trava de margem × Desconto adicional (Conceito 6)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="p-2"></th>
                  <th className="p-2 text-center">Alto desconto</th>
                  <th className="p-2 text-center">Médio desconto</th>
                  <th className="p-2 text-center">Baixo desconto</th>
                </tr>
              </thead>
              <tbody>
                {(["alta", "media", "baixa"] as const).map((trava) => (
                  <tr key={trava}>
                    <td className="p-2 text-xs font-medium capitalize text-muted-foreground">
                      Trava {trava}
                    </td>
                    {(["alto", "medio", "baixo"] as const).map((desconto) => {
                      const cell = travaDesconto.find(
                        (c) => c.trava === trava && c.desconto === desconto
                      );
                      if (!cell) return <td key={desconto} className="p-1" />;
                      return (
                        <td key={desconto} className="p-1">
                          <Cell cell={cell} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
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
  tone?: "green" | "red";
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          {icon} {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "text-2xl font-semibold",
            tone === "green" && "text-emerald-600",
            tone === "red" && "text-rose-600"
          )}
        >
          {value}
        </div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Cell({ cell }: { cell: TravaDesconto }) {
  const bg =
    cell.health === "green"
      ? "bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100"
      : cell.health === "yellow"
        ? "bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-900 dark:text-amber-100"
        : "bg-rose-50 border-rose-300 text-rose-900 dark:bg-rose-900 dark:text-rose-100";
  return (
    <div className={cn("rounded-md border p-3 text-center", bg)}>
      <div className="text-2xl font-semibold">{cell.sku_count}</div>
      <div className="text-[10px] uppercase tracking-wide">{cell.label}</div>
      {cell.skus.length > 0 && (
        <div className="mt-1 text-[10px] opacity-70">
          {cell.skus.slice(0, 3).join(", ")}
          {cell.skus.length > 3 ? ` +${cell.skus.length - 3}` : ""}
        </div>
      )}
    </div>
  );
}
