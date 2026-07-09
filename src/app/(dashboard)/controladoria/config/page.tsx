"use client";

import * as React from "react";
import { Loader2, AlertTriangle, Save, Bot, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useWorkspace } from "@/lib/workspace-context";

type Meta = {
  classifications: {
    id: string; path: string; name: string; category: string; subcategory: string | null;
    flow: number; is_transfer: boolean; is_depreciation: boolean; is_active: boolean;
  }[];
  accounts: { id: string; code: string; bank_name: string | null; agency: string | null; account_number: string | null }[];
  settings: { goals: Record<string, number | undefined> };
};

export default function ControladoriaConfigPage() {
  const { workspace } = useWorkspace();
  const [meta, setMeta] = React.useState<Meta | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [goals, setGoals] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [clsQuery, setClsQuery] = React.useState("");

  React.useEffect(() => {
    if (!workspace?.id) return;
    void fetch("/api/controladoria/meta", { headers: { "x-workspace-id": workspace.id }, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json: Meta = await r.json();
        setMeta(json);
        setGoals({
          meta_receita_mensal: json.settings.goals?.meta_receita_mensal?.toString() ?? "",
          meta_mc_pct: json.settings.goals?.meta_mc_pct?.toString() ?? "60",
          meta_ebitda_pct: json.settings.goals?.meta_ebitda_pct?.toString() ?? "5",
          meta_lucro_pct: json.settings.goals?.meta_lucro_pct?.toString() ?? "4",
          lucro_requerido: json.settings.goals?.lucro_requerido?.toString() ?? "",
          margem_seguranca_pct: json.settings.goals?.margem_seguranca_pct?.toString() ?? "5",
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "erro"));
  }, [workspace?.id]);

  const saveGoals = async () => {
    if (!workspace?.id) return;
    setSaving(true);
    try {
      const payload = {
        goals: Object.fromEntries(
          Object.entries(goals)
            .filter(([, v]) => v !== "")
            .map(([k, v]) => [k, parseFloat(v.replace(",", "."))])
        ),
      };
      const res = await fetch("/api/controladoria/meta", {
        method: "PATCH",
        headers: { "x-workspace-id": workspace.id, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const filteredCls = (meta?.classifications ?? []).filter(
    (c) =>
      !clsQuery ||
      c.name.toLowerCase().includes(clsQuery.toLowerCase()) ||
      c.category.toLowerCase().includes(clsQuery.toLowerCase())
  );

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Controladoria — Configurações</h1>
        <p className="text-sm text-muted-foreground">Metas, classificações e contas bancárias do financeiro próprio.</p>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 pt-5 text-destructive">
            <AlertTriangle className="h-4 w-4" /> {error}
          </CardContent>
        </Card>
      )}

      {!meta && !error && (
        <div className="flex items-center gap-2 text-muted-foreground py-16 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" /> Carregando…
        </div>
      )}

      {meta && (
        <Tabs defaultValue="metas">
          <TabsList>
            <TabsTrigger value="metas">Metas</TabsTrigger>
            <TabsTrigger value="automacao">Automação</TabsTrigger>
            <TabsTrigger value="classificacoes">Classificações ({meta.classifications.length})</TabsTrigger>
            <TabsTrigger value="contas">Contas ({meta.accounts.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="automacao">
            <AutoReceitasCard workspaceId={workspace?.id ?? ""} />
          </TabsContent>

          <TabsContent value="metas">
            <Card className="max-w-xl">
              <CardHeader><CardTitle className="text-base">Metas de crescimento</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground">Meta de Receita mensal (R$)</label>
                  <Input value={goals.meta_receita_mensal ?? ""} inputMode="decimal"
                    onChange={(e) => setGoals({ ...goals, meta_receita_mensal: e.target.value })} placeholder="Ex.: 650000" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Margem de Contribuição (%)</label>
                    <Input value={goals.meta_mc_pct ?? ""} inputMode="decimal"
                      onChange={(e) => setGoals({ ...goals, meta_mc_pct: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Ebitda ideal (%)</label>
                    <Input value={goals.meta_ebitda_pct ?? ""} inputMode="decimal"
                      onChange={(e) => setGoals({ ...goals, meta_ebitda_pct: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Lucro ideal (%)</label>
                    <Input value={goals.meta_lucro_pct ?? ""} inputMode="decimal"
                      onChange={(e) => setGoals({ ...goals, meta_lucro_pct: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 border-t pt-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Lucro requerido mensal (R$)</label>
                    <Input value={goals.lucro_requerido ?? ""} inputMode="decimal"
                      onChange={(e) => setGoals({ ...goals, lucro_requerido: e.target.value })} placeholder="Ex.: 105000" />
                    <p className="text-[11px] text-muted-foreground mt-0.5">Usado no Ponto de Equilíbrio Ideal.</p>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Margem de segurança (%)</label>
                    <Input value={goals.margem_seguranca_pct ?? ""} inputMode="decimal"
                      onChange={(e) => setGoals({ ...goals, margem_seguranca_pct: e.target.value })} />
                    <p className="text-[11px] text-muted-foreground mt-0.5">Usado no Ponto de Equilíbrio Ideal.</p>
                  </div>
                </div>
                <Button onClick={() => void saveGoals()} disabled={saving}>
                  {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                  Salvar metas
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="classificacoes" className="space-y-3">
            <Input value={clsQuery} onChange={(e) => setClsQuery(e.target.value)}
              placeholder="Buscar classificação ou categoria…" className="max-w-sm" />
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Classificação</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Subcategoria</TableHead>
                    <TableHead>Fluxo</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCls.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>{c.category}</TableCell>
                      <TableCell className="text-muted-foreground">{c.subcategory ?? "—"}</TableCell>
                      <TableCell>
                        {c.is_transfer ? (
                          <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">Transferência</Badge>
                        ) : c.is_depreciation ? (
                          <Badge variant="outline">Depreciação</Badge>
                        ) : c.flow === 1 ? (
                          <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300 dark:hover:bg-emerald-950">Entrada</Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-900 hover:bg-red-100 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-950">Saída</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {c.is_active
                          ? <Badge variant="outline" className="border-emerald-400 text-emerald-700 dark:text-emerald-400">ativa</Badge>
                          : <Badge variant="outline" className="text-muted-foreground">histórica</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="contas">
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sigla</TableHead>
                    <TableHead>Banco</TableHead>
                    <TableHead>Agência</TableHead>
                    <TableHead>Conta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {meta.accounts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.code}</TableCell>
                      <TableCell>{a.bank_name ?? "—"}</TableCell>
                      <TableCell>{a.agency ?? "—"}</TableCell>
                      <TableCell>{a.account_number ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

type AutoCfg = {
  enabled?: boolean;
  start_date?: string;
  last_run?: { at: string; ok: boolean; summary: string };
};

type SyncRow = { day: string; channel: string; amount: number; action: string; detail?: string };

const ACTION_LABEL: Record<string, string> = {
  created: "criado", updated: "atualizado", unchanged: "sem mudança", no_sales: "sem vendas",
  skipped_manual: "já lançado à mão", skipped_deleted: "excluído à mão (respeitado)", error: "erro",
};

function AutoReceitasCard({ workspaceId }: { workspaceId: string }) {
  const [cfg, setCfg] = React.useState<AutoCfg | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [syncRows, setSyncRows] = React.useState<SyncRow[] | null>(null);
  const headers = React.useMemo(
    () => ({ "x-workspace-id": workspaceId, "Content-Type": "application/json" }),
    [workspaceId]
  );

  React.useEffect(() => {
    if (!workspaceId) return;
    fetch("/api/controladoria/auto-receitas", { headers, cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setCfg(j.config ?? {}))
      .catch(() => setCfg({}));
  }, [workspaceId, headers]);

  const patch = async (p: Partial<AutoCfg>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/controladoria/auto-receitas", { method: "PATCH", headers, body: JSON.stringify(p) });
      const j = await res.json();
      if (res.ok) setCfg(j.config);
    } finally { setBusy(false); }
  };

  const syncNow = async () => {
    setBusy(true);
    setSyncRows(null);
    try {
      const res = await fetch("/api/controladoria/auto-receitas", { method: "POST", headers });
      const j = await res.json();
      if (res.ok) {
        setSyncRows(j.results ?? []);
        const r = await fetch("/api/controladoria/auto-receitas", { headers, cache: "no-store" }).then((x) => x.json());
        setCfg(r.config ?? {});
      } else {
        setSyncRows([{ day: "-", channel: "-", amount: 0, action: "error", detail: j.error ?? `HTTP ${res.status}` }]);
      }
    } finally { setBusy(false); }
  };

  if (!cfg) {
    return <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Bot className="h-4 w-4" /> Receitas automáticas (VNDA + Mercado Livre)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Todo dia de manhã o sistema lança a receita de ONTEM: um lançamento por canal
          (parceiro VNDA / MERCADO LIVRE, classificação Receita de Vendas, pendente),
          igual ao lançamento manual do financeiro. Cancelamentos e pedidos tardios são
          re-verificados por 7 dias — nesse período, não edite o valor dos lançamentos AUTO
          (o robô sobrescreve); depois disso eles ficam por conta do financeiro.
          Excluir um lançamento AUTO é respeitado: o robô não o recria.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2">
            <Switch checked={!!cfg.enabled} disabled={busy} onCheckedChange={(v) => void patch({ enabled: v })} />
            <span className="text-sm">{cfg.enabled ? "Ativada" : "Desativada"}</span>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Início (não lança antes desta data)</label>
            <Input type="date" value={cfg.start_date ?? ""} disabled={busy} className="w-40"
              onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch {} }}
              onChange={(e) => void patch({ start_date: e.target.value })} />
          </div>
          <Button variant="outline" disabled={busy || !workspaceId} onClick={() => void syncNow()}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
            Sincronizar agora
          </Button>
        </div>
        {cfg.last_run && (
          <p className="text-xs text-muted-foreground">
            Última rodada: {new Date(cfg.last_run.at).toLocaleString("pt-BR")} — {cfg.last_run.summary} {cfg.last_run.ok ? "✓" : "⚠️"}
          </p>
        )}
        {syncRows && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dia</TableHead><TableHead>Canal</TableHead>
                  <TableHead className="text-right">Valor</TableHead><TableHead>Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {syncRows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.day.split("-").reverse().join("/")}</TableCell>
                    <TableCell className="uppercase">{r.channel}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </TableCell>
                    <TableCell>
                      {ACTION_LABEL[r.action] ?? r.action}
                      {r.detail ? <span className="text-xs text-muted-foreground"> — {r.detail}</span> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
