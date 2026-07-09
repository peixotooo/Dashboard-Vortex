"use client";

import * as React from "react";
import { Loader2, AlertTriangle, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
            <TabsTrigger value="classificacoes">Classificações ({meta.classifications.length})</TabsTrigger>
            <TabsTrigger value="contas">Contas ({meta.accounts.length})</TabsTrigger>
          </TabsList>

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
