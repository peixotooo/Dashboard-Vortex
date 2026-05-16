"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  Save,
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
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
import { formatCurrency } from "@/lib/utils";
import {
  DEFAULT_ENGINE_SETTINGS,
  type EngineMode,
  type EngineCadence,
  type EngineSettings,
} from "@/lib/pricing/types";

type PendingItem = {
  id: string;
  sku: string;
  snapshot_date: string;
  idade_dias: number;
  cobertura_dias: number | null;
  preco_de: number;
  preco_por: number;
  desconto_pct: number;
  margem_pct: number | null;
  evento: string;
  pilar_ativo: string;
  status: string;
  status_reason: string | null;
  rule_applied: Record<string, unknown>;
  product: { name: string; image_url: string | null } | null;
};

export default function PricingConfigPage() {
  const { workspace } = useWorkspace();
  const [settings, setSettings] = useState<EngineSettings>({
    workspace_id: "",
    ...DEFAULT_ENGINE_SETTINGS,
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const loadSettings = useCallback(async () => {
    if (!workspace?.id) return;
    const res = await fetch("/api/pricing/settings", {
      headers: { "x-workspace-id": workspace.id },
    });
    const json = await res.json();
    if (res.ok) {
      setSettings(json.settings);
    }
    setLoaded(true);
  }, [workspace?.id]);

  const loadPending = useCallback(async () => {
    if (!workspace?.id) return;
    const res = await fetch("/api/pricing/engine/pending?status=pending,approved", {
      headers: { "x-workspace-id": workspace.id },
    });
    const json = await res.json();
    if (res.ok) {
      setPending(json.items ?? []);
    }
  }, [workspace?.id]);

  useEffect(() => {
    loadSettings();
    loadPending();
  }, [loadSettings, loadPending]);

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
      if (res.ok) {
        await loadPending();
      }
    } finally {
      setRunning(false);
    }
  }

  async function approve(action: "approve" | "reject") {
    if (!workspace?.id || selectedIds.size === 0) return;
    const res = await fetch("/api/pricing/engine/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": workspace.id },
      body: JSON.stringify({ ids: Array.from(selectedIds), action }),
    });
    if (res.ok) {
      setSelectedIds(new Set());
      await loadPending();
    }
  }

  async function applyToVnda() {
    if (!workspace?.id) return;
    setApplying(true);
    try {
      const res = await fetch("/api/pricing/engine/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspace.id },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await loadPending();
      }
    } finally {
      setApplying(false);
    }
  }

  const pendingPending = useMemo(
    () => pending.filter((p) => p.status === "pending"),
    [pending]
  );
  const pendingApproved = useMemo(
    () => pending.filter((p) => p.status === "approved"),
    [pending]
  );

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Configuração do engine</h1>
          <p className="text-sm text-muted-foreground">
            Parâmetros de mark down / mark up, modo de operação e fila de aprovação.
          </p>
        </div>
        <Link href="/pricing">
          <Button variant="ghost" size="sm">
            Voltar para SKUs
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Modo e cadência</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Modo</Label>
            <Select
              value={settings.modo}
              onValueChange={(v) =>
                setSettings((s) => ({ ...s, modo: v as EngineMode }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agressivo">Agressivo (1.5×)</SelectItem>
                <SelectItem value="regular">Regular (1.0×)</SelectItem>
                <SelectItem value="conservador">Conservador (0.6×)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cadência</Label>
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
            <Label className="text-xs">
              Dia da semana {settings.cadencia === "semanal" ? "" : "(só semanal)"}
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
          <div className="space-y-1">
            <Label className="text-xs">Janela de cobertura (dias)</Label>
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
          <div className="space-y-1">
            <Label className="text-xs">Trava de margem mínima (%)</Label>
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
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between rounded-md border p-2">
              <Label className="text-xs">Habilitar engine</Label>
              <Switch
                checked={settings.enabled}
                onCheckedChange={(v) => setSettings((s) => ({ ...s, enabled: v }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-2">
              <Label className="text-xs">Exigir aprovação manual</Label>
              <Switch
                checked={settings.require_approval}
                onCheckedChange={(v) =>
                  setSettings((s) => ({ ...s, require_approval: v }))
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mark Down (acelerar venda)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <NumberField
            label="Idade mínima (dias)"
            value={settings.markdown_idade_min}
            onChange={(v) => setSettings((s) => ({ ...s, markdown_idade_min: v }))}
          />
          <NumberField
            label="Cobertura mín. (dias)"
            value={settings.markdown_cobertura_min}
            onChange={(v) => setSettings((s) => ({ ...s, markdown_cobertura_min: v }))}
          />
          <NumberField
            label="Idade + cobertura mín."
            value={settings.markdown_soma_min}
            onChange={(v) => setSettings((s) => ({ ...s, markdown_soma_min: v }))}
          />
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

      <Card>
        <CardHeader>
          <CardTitle>Mark Up (recuperar margem)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <NumberField
            label="Idade máxima (dias)"
            value={settings.markup_idade_max}
            onChange={(v) => setSettings((s) => ({ ...s, markup_idade_max: v }))}
          />
          <NumberField
            label="Cobertura máx. (dias)"
            value={settings.markup_cobertura_max}
            onChange={(v) => setSettings((s) => ({ ...s, markup_cobertura_max: v }))}
          />
          <NumberField
            label="Margem máx. atual (%)"
            value={settings.markup_margem_max_pct * 100}
            step={0.5}
            onChange={(v) =>
              setSettings((s) => ({ ...s, markup_margem_max_pct: v / 100 }))
            }
          />
          <NumberField
            label="Redução por ciclo (%)"
            value={settings.markup_reducao_pct * 100}
            step={0.5}
            onChange={(v) => setSettings((s) => ({ ...s, markup_reducao_pct: v / 100 }))}
          />
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar config
        </Button>
        <Button onClick={runEngineNow} disabled={running} variant="outline" className="gap-2">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Rodar engine agora
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Fila de aprovação
            <div className="flex gap-2 text-xs">
              <Badge variant="outline">{pendingPending.length} pendentes</Badge>
              <Badge variant="default">{pendingApproved.length} aprovadas</Badge>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {pending.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma decisão pendente. Rode o engine para gerar.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => approve("approve")}
                  disabled={selectedIds.size === 0}
                  className="gap-1"
                >
                  <CheckCircle2 className="h-3 w-3" /> Aprovar {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => approve("reject")}
                  disabled={selectedIds.size === 0}
                  className="gap-1"
                >
                  <XCircle className="h-3 w-3" /> Rejeitar
                </Button>
                <div className="ml-auto" />
                <Button
                  size="sm"
                  variant="default"
                  onClick={applyToVnda}
                  disabled={applying || pendingApproved.length === 0}
                  className="gap-1"
                >
                  {applying ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  Aplicar aprovadas na VNDA ({pendingApproved.length})
                </Button>
              </div>

              <div className="divide-y rounded-md border">
                {pending.map((item) => {
                  const checked = selectedIds.has(item.id);
                  const delta = item.preco_por - item.preco_de;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          });
                        }}
                        disabled={item.status !== "pending"}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {item.product?.name ?? item.sku}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          SKU {item.sku} · idade {item.idade_dias}d · cobertura{" "}
                          {item.cobertura_dias ?? "—"}d
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <div className="text-xs text-muted-foreground line-through">
                          {formatCurrency(item.preco_de)}
                        </div>
                        <div className="font-medium">{formatCurrency(item.preco_por)}</div>
                        <div
                          className={`text-xs ${delta < 0 ? "text-emerald-600" : "text-rose-600"}`}
                        >
                          {delta < 0 ? "" : "+"}
                          {((item.desconto_pct - 0) * 100).toFixed(1)}% desc
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <EventBadge evento={item.evento} />
                        <StatusBadge status={item.status} />
                        {item.status_reason && (
                          <div className="max-w-[200px] truncate text-[10px] text-muted-foreground" title={item.status_reason}>
                            {item.status_reason}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
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

function EventBadge({ evento }: { evento: string }) {
  if (evento === "markdown") return <Badge className="bg-rose-100 text-rose-900 hover:bg-rose-100">Markdown</Badge>;
  if (evento === "markup") return <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Markup</Badge>;
  if (evento === "campanha") return <Badge className="bg-purple-100 text-purple-900 hover:bg-purple-100">Campanha</Badge>;
  return <Badge variant="outline">{evento}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "applied") {
    return (
      <Badge className="gap-1 bg-emerald-100 text-emerald-900 hover:bg-emerald-100">
        <CheckCircle2 className="h-3 w-3" /> Aplicado
      </Badge>
    );
  }
  if (status === "approved") {
    return (
      <Badge className="gap-1 bg-blue-100 text-blue-900 hover:bg-blue-100">
        <CheckCircle2 className="h-3 w-3" /> Aprovado
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge className="gap-1" variant="outline">
        <XCircle className="h-3 w-3" /> Rejeitado
      </Badge>
    );
  }
  if (status === "skipped") {
    return (
      <Badge className="gap-1" variant="outline">
        Skip
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-amber-100 text-amber-900 hover:bg-amber-100">
      <AlertTriangle className="h-3 w-3" /> Pendente
    </Badge>
  );
}
