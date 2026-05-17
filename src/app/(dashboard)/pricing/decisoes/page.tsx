"use client";

// Fila de aprovação visual — uma das telas mais importantes do módulo.
//
// Foco: tornar óbvio qual a próxima ação. Cada decisão é um card auto-contido:
//   - Hero "De X por Y" com delta percentual
//   - Badge de saúde (verde/amarelo/vermelho) por status da margem
//   - "Por quê?" inline (idade + cobertura + regra)
//   - Botões grandes: Aprovar / Rejeitar
// Em lote: "Aprovar zona verde" (margem >= alvo da composição), filtros por
// tipo + ordenação. Aplicar VNDA no fim da fila depois das aprovações.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Send,
  ArrowRight,
  Filter,
  AlertTriangle,
  Package,
  TrendingDown,
  TrendingUp,
  Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";
import { formatCurrency, cn } from "@/lib/utils";

type Decision = {
  id: string;
  sku: string;
  snapshot_date: string;
  idade_dias: number;
  cobertura_dias: number | null;
  stock_units: number;
  vendas_dia_unidades: number;
  preco_de: number;
  preco_por: number;
  desconto_pct: number;
  margem_pct: number | null;
  evento: "markdown" | "markup" | "baseline" | "campanha" | "combo" | "manual" | "hold";
  status: "pending" | "approved" | "rejected" | "applied" | "skipped";
  status_reason: string | null;
  rule_applied: Record<string, unknown>;
  product: { name: string; image_url: string | null } | null;
};

type Filter = "all" | "markdown" | "markup";
type Sort = "delta_desc" | "margem_asc" | "idade_desc" | "cobertura_desc";

export default function DecisoesPage() {
  const { workspace } = useWorkspace();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("delta_desc");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const res = await fetch(
        "/api/pricing/engine/pending?status=pending,approved&limit=200",
        { headers: { "x-workspace-id": workspace.id } }
      );
      const json = await res.json();
      if (res.ok) setDecisions(json.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let arr = decisions.filter((d) =>
      filter === "all" ? true : d.evento === filter
    );
    arr = [...arr].sort((a, b) => {
      switch (sort) {
        case "delta_desc": {
          const da = a.preco_de > 0 ? (a.preco_de - a.preco_por) / a.preco_de : 0;
          const db = b.preco_de > 0 ? (b.preco_de - b.preco_por) / b.preco_de : 0;
          return db - da;
        }
        case "margem_asc":
          return (a.margem_pct ?? 0) - (b.margem_pct ?? 0);
        case "idade_desc":
          return b.idade_dias - a.idade_dias;
        case "cobertura_desc":
          return (b.cobertura_dias ?? 0) - (a.cobertura_dias ?? 0);
      }
    });
    return arr;
  }, [decisions, filter, sort]);

  const counts = useMemo(() => {
    const pending = decisions.filter((d) => d.status === "pending").length;
    const approved = decisions.filter((d) => d.status === "approved").length;
    const markdowns = decisions.filter((d) => d.evento === "markdown").length;
    const markups = decisions.filter((d) => d.evento === "markup").length;
    return { pending, approved, markdowns, markups };
  }, [decisions]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedIds(new Set(filtered.filter((d) => d.status === "pending").map((d) => d.id)));
  }

  function selectGreenZone() {
    // Verde = margem nova >= trava E é markdown saudável (não bloqueado por trava)
    const greens = filtered.filter((d) => {
      if (d.status !== "pending") return false;
      const rule = d.rule_applied as { trava_margem_minima_pct?: number };
      const trava = Number(rule?.trava_margem_minima_pct ?? 0.10);
      return d.margem_pct != null && d.margem_pct >= trava;
    });
    setSelectedIds(new Set(greens.map((d) => d.id)));
  }

  async function bulk(action: "approve" | "reject") {
    if (!workspace?.id || selectedIds.size === 0) return;
    setBusy(true);
    try {
      await fetch("/api/pricing/engine/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspace.id },
        body: JSON.stringify({ ids: Array.from(selectedIds), action }),
      });
      setSelectedIds(new Set());
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function applyToVnda() {
    if (!workspace?.id) return;
    setBusy(true);
    try {
      const res = await fetch("/api/pricing/engine/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspace.id },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      // Mostra resultado simples — futuro pode virar toast
      alert(
        `Aplicado: ${json.applied ?? 0} · Falhas: ${json.failed ?? 0}${
          json.error ? `\nErro: ${json.error}` : ""
        }`
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Decisões pendentes</h1>
          <p className="text-sm text-muted-foreground">
            {counts.pending} aguardando aprovação · {counts.approved} aprovadas prontas pra aplicar
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/pricing">
            <Button variant="ghost" size="sm">
              ← Dashboard
            </Button>
          </Link>
          <Link href="/pricing/config">
            <Button variant="outline" size="sm">
              Configurar regras
            </Button>
          </Link>
        </div>
      </div>

      {/* Resumo & Bulk Actions */}
      <Card className="border-2">
        <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="outline" className="gap-1">
              <TrendingDown className="h-3 w-3" /> {counts.markdowns} markdowns
            </Badge>
            <Badge variant="outline" className="gap-1">
              <TrendingUp className="h-3 w-3" /> {counts.markups} markups
            </Badge>
            {selectedIds.size > 0 && (
              <Badge className="bg-blue-100 text-blue-900 hover:bg-blue-100">
                {selectedIds.size} selecionadas
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={selectGreenZone}
              disabled={busy}
              className="gap-1"
            >
              <Sparkles className="h-3 w-3" /> Selecionar zona verde
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={selectAllVisible}
              disabled={busy}
            >
              Selecionar todas
            </Button>
            <Button
              size="sm"
              onClick={() => bulk("approve")}
              disabled={busy || selectedIds.size === 0}
              className="gap-1"
            >
              <CheckCircle2 className="h-3 w-3" /> Aprovar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => bulk("reject")}
              disabled={busy || selectedIds.size === 0}
              className="gap-1"
            >
              <XCircle className="h-3 w-3" /> Rejeitar
            </Button>
            <Button
              size="sm"
              onClick={applyToVnda}
              disabled={busy || counts.approved === 0}
              className="gap-1 bg-emerald-600 hover:bg-emerald-700"
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              Aplicar {counts.approved} na VNDA
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Filter className="h-3 w-3 text-muted-foreground" />
        <span className="text-muted-foreground">Tipo:</span>
        {(["all", "markdown", "markup"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-3 py-1 transition",
              filter === f
                ? "border-foreground bg-foreground text-background"
                : "border-border hover:bg-muted"
            )}
          >
            {f === "all" ? "Todas" : f === "markdown" ? "Markdown" : "Markup"}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground">Ordenar:</span>
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger className="h-7 w-[200px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="delta_desc">Maior delta de preço</SelectItem>
              <SelectItem value="margem_asc">Menor margem nova</SelectItem>
              <SelectItem value="idade_desc">Maior idade</SelectItem>
              <SelectItem value="cobertura_desc">Maior cobertura</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-600" />
            Nenhuma decisão pendente.
            <br />
            Rode o engine na tela de configuração ou aguarde o cron diário.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((d) => (
            <DecisionCard
              key={d.id}
              decision={d}
              selected={selectedIds.has(d.id)}
              onToggle={() => toggleSelect(d.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DecisionCard({
  decision: d,
  selected,
  onToggle,
}: {
  decision: Decision;
  selected: boolean;
  onToggle: () => void;
}) {
  const rule = d.rule_applied as {
    modo?: string;
    trava_margem_minima_pct?: number;
    incremento_aplicado_pct?: number;
    reducao_aplicada_pct?: number;
  };
  const trava = Number(rule?.trava_margem_minima_pct ?? 0.10);
  const delta = d.preco_de > 0 ? (d.preco_por - d.preco_de) / d.preco_de : 0;
  const deltaPct = delta * 100;

  // Health zone — alvo é margem nova vs trava de margem
  let zone: "green" | "yellow" | "red" = "yellow";
  if (d.margem_pct != null) {
    if (d.margem_pct >= trava + 0.10) zone = "green"; // ≥10pp acima da trava
    else if (d.margem_pct >= trava) zone = "yellow";
    else zone = "red";
  }

  const zoneStyles = {
    green: "border-l-emerald-500",
    yellow: "border-l-amber-500",
    red: "border-l-rose-500",
  }[zone];

  const eventLabel =
    d.evento === "markdown" ? (
      <Badge className="bg-rose-100 text-rose-900 hover:bg-rose-100">
        <TrendingDown className="mr-1 h-3 w-3" /> Markdown
      </Badge>
    ) : d.evento === "markup" ? (
      <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">
        <TrendingUp className="mr-1 h-3 w-3" /> Markup
      </Badge>
    ) : (
      <Badge variant="outline">{d.evento}</Badge>
    );

  const statusBadge =
    d.status === "approved" ? (
      <Badge className="bg-blue-100 text-blue-900 hover:bg-blue-100">
        ✓ Aprovado · aguardando aplicar
      </Badge>
    ) : null;

  return (
    <Card className={cn("border-l-4 transition hover:shadow-md", zoneStyles)}>
      <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-stretch md:gap-4">
        {/* Checkbox + img */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            disabled={d.status !== "pending"}
            className="mt-1 h-4 w-4 cursor-pointer"
          />
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
            {d.product?.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={d.product.image_url}
                alt={d.product.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <Package className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Hero — preço de/por e delta */}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium">
              {d.product?.name ?? d.sku}
            </h3>
            {eventLabel}
            {statusBadge}
          </div>
          <div className="text-xs text-muted-foreground">SKU {d.sku}</div>

          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-sm text-muted-foreground line-through">
              {formatCurrency(d.preco_de)}
            </span>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className="text-2xl font-semibold tracking-tight">
              {formatCurrency(d.preco_por)}
            </span>
            <span
              className={cn(
                "text-sm font-medium",
                delta < 0 ? "text-rose-600" : "text-emerald-600"
              )}
            >
              {deltaPct > 0 ? "+" : ""}
              {deltaPct.toFixed(1)}%
            </span>
          </div>

          {/* Contexto */}
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-4">
            <Metric label="Idade" value={`${d.idade_dias}d`} />
            <Metric
              label="Cobertura"
              value={d.cobertura_dias != null ? `${d.cobertura_dias}d` : "—"}
            />
            <Metric
              label="Margem nova"
              value={d.margem_pct != null ? `${(d.margem_pct * 100).toFixed(1)}%` : "—"}
              tone={zone === "green" ? "good" : zone === "red" ? "bad" : "warn"}
              hint={`trava ${(trava * 100).toFixed(0)}%`}
            />
            <Metric label="Estoque" value={String(d.stock_units)} />
          </div>

          {/* Reason */}
          {d.status_reason && (
            <div className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {d.status_reason}
            </div>
          )}

          {zone === "red" && (
            <div className="mt-2 flex items-center gap-1 text-xs text-rose-600">
              <AlertTriangle className="h-3 w-3" /> Margem nova abaixo da trava de
              segurança — revisar antes de aprovar.
            </div>
          )}
        </div>

        {/* Ações */}
        <div className="flex shrink-0 flex-col gap-2 md:items-end">
          <Link href={`/pricing/sku/${encodeURIComponent(d.sku)}`}>
            <Button variant="ghost" size="sm" className="w-full md:w-auto">
              Ver SKU →
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
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
          "text-sm font-medium",
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
