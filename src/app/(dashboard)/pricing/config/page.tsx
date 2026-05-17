"use client";

// Configuração do engine — apenas regras, modo, cadência, trava e import CSV.
// Fila de aprovação foi movida pra /pricing/decisoes.

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  Save,
  Play,
  Upload,
  ArrowRight,
  Settings as SettingsIcon,
  Zap,
  Gauge,
  Shield,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import {
  DEFAULT_ENGINE_SETTINGS,
  type EngineMode,
  type EngineCadence,
  type EngineSettings,
} from "@/lib/pricing/types";

const MODES: Array<{
  value: EngineMode;
  label: string;
  multiplier: string;
  description: string;
  best_for: string;
  color: string;
}> = [
  {
    value: "agressivo",
    label: "Agressivo",
    multiplier: "1.5×",
    description: "Altos descontos incrementais, baixa redução. Markdown mais rápido.",
    best_for: "Black Friday, queima de coleção, alta competitividade",
    color: "border-rose-300 bg-rose-50 dark:bg-rose-950 dark:border-rose-900",
  },
  {
    value: "regular",
    label: "Regular",
    multiplier: "1.0×",
    description: "Descontos incrementais e decrementais médios.",
    best_for: "Dia-a-dia e estoque controlado",
    color: "border-blue-300 bg-blue-50 dark:bg-blue-950 dark:border-blue-900",
  },
  {
    value: "conservador",
    label: "Conservador",
    multiplier: "0.6×",
    description: "Decremento mínimo, inputs conservadores. Markdown lento.",
    best_for: "Cenário de baixa oferta, produto exclusivo",
    color: "border-emerald-300 bg-emerald-50 dark:bg-emerald-950 dark:border-emerald-900",
  },
];

export default function PricingConfigPage() {
  const { workspace } = useWorkspace();
  const [settings, setSettings] = useState<EngineSettings>({
    workspace_id: "",
    ...DEFAULT_ENGINE_SETTINGS,
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number;
    total: number;
    with_total: number;
    with_pl_only: number;
    empty: number;
  } | null>(null);

  const loadSettings = useCallback(async () => {
    if (!workspace?.id) return;
    const res = await fetch("/api/pricing/settings", {
      headers: { "x-workspace-id": workspace.id },
    });
    const json = await res.json();
    if (res.ok) setSettings(json.settings);
    setLoaded(true);
  }, [workspace?.id]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  async function save() {
    if (!workspace?.id) return;
    setSaving(true);
    try {
      const res = await fetch("/api/pricing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspace.id },
        body: JSON.stringify(settings),
      });
      if (res.ok) await loadSettings();
    } finally {
      setSaving(false);
    }
  }

  async function runEngineNow() {
    if (!workspace?.id) return;
    setRunning(true);
    try {
      const res = await fetch("/api/pricing/engine/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspace.id },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (res.ok) {
        alert(
          `Engine processou ${json.evaluated} SKUs. ${json.decisions?.filter((d: { action: string }) => d.action !== "hold").length ?? 0} decisões geradas. Revise em "Decisões".`
        );
      } else {
        alert(`Erro: ${json.error}`);
      }
    } finally {
      setRunning(false);
    }
  }

  async function importCmvFromCsv(file?: File) {
    if (!workspace?.id) return;
    setImporting(true);
    setImportResult(null);
    try {
      let res: Response;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        res = await fetch("/api/pricing/import/cmv", {
          method: "POST",
          headers: { "x-workspace-id": workspace.id },
          body: fd,
        });
      } else {
        res = await fetch("/api/pricing/import/cmv", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-workspace-id": workspace.id },
          body: JSON.stringify({ source: "public", filename: "SENSE - BULKING - BD.csv" }),
        });
      }
      const json = await res.json();
      if (res.ok) setImportResult(json);
    } finally {
      setImporting(false);
    }
  }

  if (!loaded) {
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
          <h1 className="text-2xl font-semibold">Configurações</h1>
          <p className="text-sm text-muted-foreground">
            Regras do engine, modo de operação e import de custos.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/pricing/decisoes">
            <Button variant="outline" size="sm" className="gap-1">
              Ver decisões pendentes <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Status do engine */}
      <Card className="border-2">
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "h-3 w-3 rounded-full",
                settings.enabled ? "bg-emerald-500" : "bg-muted-foreground"
              )}
            />
            <div>
              <div className="text-sm font-medium">
                Engine {settings.enabled ? "habilitado" : "desabilitado"}
              </div>
              <div className="text-xs text-muted-foreground">
                {settings.enabled
                  ? `Cron diário 5h UTC · cadência ${settings.cadencia}${settings.cadencia === "semanal" ? ` (${["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][settings.cadencia_dia_semana]})` : ""}`
                  : "Cron não vai rodar até ativar"}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={runEngineNow}
              disabled={running}
              variant="outline"
              size="sm"
              className="gap-1"
            >
              {running ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              Rodar agora
            </Button>
            <Button onClick={save} disabled={saving} size="sm" className="gap-1">
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Salvar configurações
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Modo de operação — cards visuais */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4" /> Modo de operação
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setSettings((s) => ({ ...s, modo: m.value }))}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-lg border-2 p-3 text-left transition hover:shadow",
                  settings.modo === m.value
                    ? m.color
                    : "border-border bg-background hover:border-muted-foreground/50"
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="font-semibold">{m.label}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {m.multiplier}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{m.description}</p>
                <p className="text-[10px] text-muted-foreground">
                  <strong>Ideal pra:</strong> {m.best_for}
                </p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Cadência + Trava + Toggles */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-4 w-4" /> Cadência e janela
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Frequência</Label>
                <Select
                  value={settings.cadencia}
                  onValueChange={(v) =>
                    setSettings((s) => ({ ...s, cadencia: v as EngineCadence }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="diaria">Diária</SelectItem>
                    <SelectItem value="semanal">Semanal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label
                  className={cn(
                    "text-xs",
                    settings.cadencia !== "semanal" && "text-muted-foreground"
                  )}
                >
                  Dia da semana
                </Label>
                <Select
                  value={String(settings.cadencia_dia_semana)}
                  onValueChange={(v) =>
                    setSettings((s) => ({ ...s, cadencia_dia_semana: Number(v) }))
                  }
                  disabled={settings.cadencia !== "semanal"}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      ["0", "Domingo"],
                      ["1", "Segunda"],
                      ["2", "Terça"],
                      ["3", "Quarta"],
                      ["4", "Quinta"],
                      ["5", "Sexta"],
                      ["6", "Sábado"],
                    ].map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Janela de cobertura (dias)
                <span className="ml-1 text-muted-foreground">
                  · média móvel de unidades vendidas
                </span>
              </Label>
              <Input
                type="number"
                min={7}
                max={90}
                value={settings.cobertura_janela_dias}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    cobertura_janela_dias: Number(e.target.value),
                  }))
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" /> Travas e segurança
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">
                Trava de margem mínima (%)
                <span className="ml-1 text-muted-foreground">
                  · markdown nunca quebra essa
                </span>
              </Label>
              <Input
                type="number"
                step="0.1"
                value={(settings.trava_margem_minima_pct * 100).toFixed(1)}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    trava_margem_minima_pct: Number(e.target.value) / 100,
                  }))
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-2">
              <div>
                <Label className="text-xs">Engine habilitado</Label>
                <p className="text-[10px] text-muted-foreground">
                  Quando OFF, cron não roda
                </p>
              </div>
              <Switch
                checked={settings.enabled}
                onCheckedChange={(v) => setSettings((s) => ({ ...s, enabled: v }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-2">
              <div>
                <Label className="text-xs">Aprovação manual</Label>
                <p className="text-[10px] text-muted-foreground">
                  Decisões caem em pending pra revisão
                </p>
              </div>
              <Switch
                checked={settings.require_approval}
                onCheckedChange={(v) =>
                  setSettings((s) => ({ ...s, require_approval: v }))
                }
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Mark Down + Mark Up — agrupados */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="border-rose-200 dark:border-rose-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-rose-700 dark:text-rose-300">
              Mark Down — acelerar venda
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Reduzir preço pra girar SKUs velhos / com muito estoque
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <NumberField
              label="Idade mín. (d)"
              value={settings.markdown_idade_min}
              onChange={(v) => setSettings((s) => ({ ...s, markdown_idade_min: v }))}
            />
            <NumberField
              label="Cobertura mín. (d)"
              value={settings.markdown_cobertura_min}
              onChange={(v) => setSettings((s) => ({ ...s, markdown_cobertura_min: v }))}
            />
            <NumberField
              label="Idade + cobertura mín."
              value={settings.markdown_soma_min}
              onChange={(v) => setSettings((s) => ({ ...s, markdown_soma_min: v }))}
            />
            <div />
            <NumberField
              label="Desconto inicial (%)"
              value={settings.markdown_desconto_inicial_pct * 100}
              step={0.5}
              onChange={(v) =>
                setSettings((s) => ({ ...s, markdown_desconto_inicial_pct: v / 100 }))
              }
            />
            <NumberField
              label="Incremento por ciclo (%)"
              value={settings.markdown_incremento_pct * 100}
              step={0.5}
              onChange={(v) =>
                setSettings((s) => ({ ...s, markdown_incremento_pct: v / 100 }))
              }
            />
          </CardContent>
        </Card>

        <Card className="border-emerald-200 dark:border-emerald-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-emerald-700 dark:text-emerald-300">
              Step Up — recuperar preço
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Reduzir desconto em SKUs já descontados que estão girando rápido —
              testa se a demanda aguenta preço maior
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <NumberField
              label="Cobertura máx. (d)"
              value={settings.markup_cobertura_max}
              onChange={(v) => setSettings((s) => ({ ...s, markup_cobertura_max: v }))}
            />
            <NumberField
              label="Redução por ciclo (%)"
              value={settings.markup_reducao_pct * 100}
              step={0.5}
              onChange={(v) =>
                setSettings((s) => ({ ...s, markup_reducao_pct: v / 100 }))
              }
            />
          </CardContent>
        </Card>
      </div>

      {/* Import CSV */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4" /> Importar CMV via CSV
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Formato BULKING: Código, Produto, Categoria, Valor PL, Corte, Tecido,
            Aviamentos, Estampa, Costura, TOTAL PRODUÇÃO. SKUs sem custo cadastrado
            herdam média da categoria automaticamente.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => importCmvFromCsv()}
              disabled={importing}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              {importing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
              Importar do servidor
              <span className="text-[10px] text-muted-foreground">
                /public/SENSE - BULKING - BD.csv
              </span>
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
              <Upload className="h-3 w-3" /> Subir CSV
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importCmvFromCsv(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {importResult && (
            <div className="mt-3 rounded-md border bg-muted/30 p-3 text-xs">
              <strong>{importResult.imported}</strong> SKUs importados ·{" "}
              {importResult.with_total} com TOTAL · {importResult.with_pl_only} só
              Valor PL · {importResult.empty} sem custo (vão usar média de categoria)
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
