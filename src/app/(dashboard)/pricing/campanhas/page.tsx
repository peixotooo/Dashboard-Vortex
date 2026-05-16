"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Loader2,
  X,
  AlertTriangle,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type Combo = {
  id: string;
  name: string;
  description: string | null;
  combo_type: "fixed_total" | "percent_off";
  sku_ids: string[];
  combo_size: number;
  combo_price_brl: number | null;
  discount_pct: number | null;
  starts_at: string;
  ends_at: string;
  meta_faturamento_brl: number | null;
  cpa_breakeven_brl: number | null;
  cobertura_estoque_dias: number | null;
  status: string;
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
  scheduled: { label: "Agendado", color: "bg-blue-100 text-blue-900" },
  active: { label: "Ativo", color: "bg-emerald-100 text-emerald-900" },
  expired: { label: "Expirado", color: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelado", color: "bg-rose-100 text-rose-900" },
};

export default function CampaignsPage() {
  const { workspace } = useWorkspace();
  const [combos, setCombos] = useState<Combo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [comboType, setComboType] = useState<"fixed_total" | "percent_off">(
    "fixed_total"
  );
  const [comboSize, setComboSize] = useState(3);
  const [comboPrice, setComboPrice] = useState(199);
  const [discountPct, setDiscountPct] = useState(10);
  const [skusText, setSkusText] = useState("");
  const [startsAt, setStartsAt] = useState(() =>
    new Date().toISOString().slice(0, 16)
  );
  const [endsAt, setEndsAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 16);
  });

  const load = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const res = await fetch("/api/pricing/combos", {
        headers: { "x-workspace-id": workspace.id },
      });
      const json = await res.json();
      if (res.ok) setCombos(json.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!workspace?.id) return;
    const skus = skusText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (skus.length === 0) return;

    setCreating(true);
    try {
      const res = await fetch("/api/pricing/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": workspace.id },
        body: JSON.stringify({
          name,
          description,
          combo_type: comboType,
          sku_ids: skus,
          combo_size: comboSize,
          combo_price_brl: comboType === "fixed_total" ? comboPrice : null,
          discount_pct: comboType === "percent_off" ? discountPct / 100 : null,
          starts_at: new Date(startsAt).toISOString(),
          ends_at: new Date(endsAt).toISOString(),
          status: "scheduled",
        }),
      });
      if (res.ok) {
        setShowForm(false);
        setName("");
        setDescription("");
        setSkusText("");
        await load();
      }
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    if (!workspace?.id) return;
    if (!confirm("Excluir combo?")) return;
    const res = await fetch(`/api/pricing/combos/${id}`, {
      method: "DELETE",
      headers: { "x-workspace-id": workspace.id },
    });
    if (res.ok) await load();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Campanhas / Combos</h1>
          <p className="text-sm text-muted-foreground">
            Combos sobrepõem o pricing dinâmico nas datas vigentes.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)} className="gap-2">
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? "Cancelar" : "Novo combo"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Novo combo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">Nome</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: 3 tênis femininos por R$ 199"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">Descrição</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Contexto interno do combo"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tipo</Label>
                <Select
                  value={comboType}
                  onValueChange={(v) =>
                    setComboType(v as "fixed_total" | "percent_off")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed_total">Preço fixo (N por R$ X)</SelectItem>
                    <SelectItem value="percent_off">% off no Nº item</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tamanho (combo_size)</Label>
                <Input
                  type="number"
                  min={1}
                  value={comboSize}
                  onChange={(e) => setComboSize(Number(e.target.value))}
                />
              </div>
              {comboType === "fixed_total" ? (
                <div className="space-y-1">
                  <Label className="text-xs">Preço do combo (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={comboPrice}
                    onChange={(e) => setComboPrice(Number(e.target.value))}
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-xs">Desconto (%)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={discountPct}
                    onChange={(e) => setDiscountPct(Number(e.target.value))}
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Início</Label>
                <Input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fim</Label>
                <Input
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">SKUs participantes (um por linha ou separados por vírgula)</Label>
                <textarea
                  className="min-h-[80px] w-full rounded-md border bg-background p-2 text-sm"
                  value={skusText}
                  onChange={(e) => setSkusText(e.target.value)}
                  placeholder="775846220&#10;775846221&#10;..."
                />
              </div>
            </div>
            <Button onClick={create} disabled={creating || !name} className="gap-2">
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Criar combo
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Combos cadastrados</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : combos.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhum combo ainda.
            </div>
          ) : (
            <div className="divide-y rounded-md border">
              {combos.map((c) => {
                const status = STATUS_LABELS[c.status] ?? STATUS_LABELS.draft;
                const coberturaWarn =
                  c.cobertura_estoque_dias != null &&
                  c.cobertura_estoque_dias < 7;
                return (
                  <div key={c.id} className="flex items-start gap-3 p-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.name}</span>
                        <Badge className={status.color}>{status.label}</Badge>
                        {c.combo_type === "fixed_total" ? (
                          <Badge variant="outline">
                            {c.combo_size} × {formatCurrency(c.combo_price_brl ?? 0)}
                          </Badge>
                        ) : (
                          <Badge variant="outline">
                            {((c.discount_pct ?? 0) * 100).toFixed(0)}% off
                          </Badge>
                        )}
                      </div>
                      {c.description && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {c.description}
                        </div>
                      )}
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                        <Metric
                          label="SKUs"
                          value={`${c.sku_ids.length} produtos`}
                        />
                        <Metric
                          label="CPA breakeven"
                          value={
                            c.cpa_breakeven_brl != null
                              ? formatCurrency(c.cpa_breakeven_brl)
                              : "—"
                          }
                        />
                        <Metric
                          label="Cobertura"
                          value={
                            c.cobertura_estoque_dias != null
                              ? `${c.cobertura_estoque_dias} dias`
                              : "—"
                          }
                          warn={coberturaWarn}
                        />
                        <Metric
                          label="Vigência"
                          value={`${new Date(c.starts_at).toLocaleDateString("pt-BR")} → ${new Date(c.ends_at).toLocaleDateString("pt-BR")}`}
                        />
                      </div>
                      {coberturaWarn && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-rose-600">
                          <AlertTriangle className="h-3 w-3" /> Estoque cobre menos de 7
                          dias — considere reforçar OC do SKU mais escasso.
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(c.id)}
                      className="gap-1 text-rose-600 hover:text-rose-700"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className={cn(warn && "text-rose-600")}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
