"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  LayoutGrid,
  Plus,
  RefreshCw,
  Loader2,
  Eye,
  MousePointerClick,
  Percent,
  Package,
  Copy,
  Check,
  Trash2,
  Pencil,
  Power,
  Key,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { formatNumber } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

// --- Constants ---

const ALGORITHMS = [
  { value: "bestsellers", label: "Mais Vendidos" },
  { value: "news", label: "Lancamentos" },
  { value: "offers", label: "Ofertas" },
  { value: "most_popular", label: "Mais Vistos" },
  { value: "last_viewed", label: "Vistos Recentemente" },
] as const;

const PAGE_TYPES = [
  { value: "home", label: "Home" },
  { value: "product", label: "Produto" },
  { value: "category", label: "Categoria" },
  { value: "cart", label: "Carrinho" },
] as const;

const ALGORITHM_LABELS: Record<string, string> = Object.fromEntries(
  ALGORITHMS.map((a) => [a.value, a.label])
);

const PAGE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  PAGE_TYPES.map((p) => [p.value, p.label])
);

// --- Types ---

interface ShelfConfig {
  id: string;
  workspace_id: string;
  page_type: string;
  position: number;
  anchor_selector: string | null;
  algorithm: string;
  title: string;
  max_products: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface ShelfAnalytics {
  totalImpressions: number;
  totalClicks: number;
  avgCtr: number;
  shelves: Array<
    ShelfConfig & { impressions: number; clicks: number; ctr: number }
  >;
}

interface ApiKey {
  id: string;
  key: string;
  name: string;
  active: boolean;
  created_at: string;
}

interface SyncLog {
  synced: number;
  errors: number;
  total: number;
}

// --- Component ---

export default function ShelvesPage() {
  const { workspace } = useWorkspace();
  const [configs, setConfigs] = useState<ShelfConfig[]>([]);
  const [analytics, setAnalytics] = useState<ShelfAnalytics | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncLog | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ShelfConfig | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "x-workspace-id": workspace?.id || "",
    }),
    [workspace?.id]
  );

  // --- Data loading ---

  const loadConfigs = useCallback(async () => {
    if (!workspace?.id) return;
    const res = await fetch("/api/shelves/configs", { headers: headers() });
    const data = await res.json();
    setConfigs(data.configs || []);
  }, [workspace?.id, headers]);

  const loadAnalytics = useCallback(async () => {
    if (!workspace?.id) return;
    const res = await fetch("/api/shelves/analytics", { headers: headers() });
    const data = await res.json();
    setAnalytics(data);
  }, [workspace?.id, headers]);

  const loadApiKeys = useCallback(async () => {
    if (!workspace?.id) return;
    const res = await fetch("/api/shelves/api-keys", { headers: headers() });
    const data = await res.json();
    setApiKeys(data.keys || []);
  }, [workspace?.id, headers]);

  useEffect(() => {
    if (workspace?.id) {
      Promise.all([loadConfigs(), loadAnalytics(), loadApiKeys()]).finally(() =>
        setLoading(false)
      );
    }
  }, [workspace?.id, loadConfigs, loadAnalytics, loadApiKeys]);

  // --- Actions ---

  async function handleCreateOrUpdate(formData: {
    page_type: string;
    position: number;
    algorithm: string;
    title: string;
    max_products: number;
    anchor_selector: string;
  }) {
    if (editingConfig) {
      await fetch(`/api/shelves/configs/${editingConfig.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify(formData),
      });
    } else {
      await fetch("/api/shelves/configs", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(formData),
      });
    }
    setDialogOpen(false);
    setEditingConfig(null);
    await loadConfigs();
  }

  async function handleToggle(config: ShelfConfig) {
    await fetch(`/api/shelves/configs/${config.id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ enabled: !config.enabled }),
    });
    await loadConfigs();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/shelves/configs/${id}`, {
      method: "DELETE",
      headers: headers(),
    });
    await loadConfigs();
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/shelves/catalog/sync", {
        method: "POST",
        headers: headers(),
      });
      const data = await res.json();
      setSyncResult(data);
    } catch {
      setSyncResult({ synced: 0, errors: 1, total: 0 });
    } finally {
      setSyncing(false);
    }
  }

  async function handleCreateApiKey() {
    await fetch("/api/shelves/api-keys", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: "default" }),
    });
    await loadApiKeys();
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  // --- Group configs by page type ---

  const groupedConfigs = PAGE_TYPES.map((pt) => ({
    ...pt,
    configs: configs
      .filter((c) => c.page_type === pt.value)
      .sort((a, b) => a.position - b.position),
  }));

  const activeCount = configs.filter((c) => c.enabled).length;

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Prateleiras Inteligentes</h1>
          <p className="text-muted-foreground mt-1">
            Configure as vitrines de recomendacao da loja
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              loadConfigs();
              loadAnalytics();
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Atualizar
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button
                onClick={() => {
                  setEditingConfig(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Nova Prateleira
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingConfig ? "Editar Prateleira" : "Nova Prateleira"}
                </DialogTitle>
              </DialogHeader>
              <ShelfConfigForm
                initial={editingConfig}
                onSubmit={handleCreateOrUpdate}
                onCancel={() => {
                  setDialogOpen(false);
                  setEditingConfig(null);
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard
          title="Prateleiras Ativas"
          value={String(activeCount)}
          icon={LayoutGrid}
        />
        <KpiCard
          title="Impressoes (30d)"
          value={formatNumber(analytics?.totalImpressions || 0)}
          icon={Eye}
        />
        <KpiCard
          title="Cliques (30d)"
          value={formatNumber(analytics?.totalClicks || 0)}
          icon={MousePointerClick}
        />
        <KpiCard
          title="CTR Medio"
          value={
            analytics?.avgCtr
              ? `${(analytics.avgCtr * 100).toFixed(2)}%`
              : "0%"
          }
          icon={Percent}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="configs">
        <TabsList>
          <TabsTrigger value="configs">Configuracoes</TabsTrigger>
          <TabsTrigger value="catalog">Catalogo</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="install">Instalacao</TabsTrigger>
        </TabsList>

        {/* Configurations Tab */}
        <TabsContent value="configs" className="space-y-6 mt-4">
          {groupedConfigs.map((group) => (
            <Card key={group.value}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  {group.label}
                  <Badge variant="secondary">
                    {group.configs.length} prateleira
                    {group.configs.length !== 1 ? "s" : ""}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {group.configs.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Nenhuma prateleira configurada para esta pagina
                  </p>
                ) : (
                  <div className="space-y-2">
                    {group.configs.map((config) => (
                      <div
                        key={config.id}
                        className="flex items-center justify-between rounded-lg border p-3"
                      >
                        <div className="flex items-center gap-4">
                          <span className="text-sm font-mono text-muted-foreground w-6">
                            #{config.position}
                          </span>
                          <div>
                            <p className="font-medium">{config.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {ALGORITHM_LABELS[config.algorithm] ||
                                config.algorithm}{" "}
                              · {config.max_products} produtos
                              {config.anchor_selector &&
                                ` · ${config.anchor_selector}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={config.enabled ? "default" : "secondary"}
                          >
                            {config.enabled ? "Ativo" : "Inativo"}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggle(config)}
                            title={
                              config.enabled ? "Desativar" : "Ativar"
                            }
                          >
                            <Power className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingConfig(config);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(config.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Catalog Tab */}
        <TabsContent value="catalog" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">
                  Catalogo de Produtos
                </CardTitle>
                <Button onClick={handleSync} disabled={syncing}>
                  {syncing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Sincronizar VNDA
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {syncResult && (
                <div
                  className={`rounded-lg p-4 mb-4 ${
                    syncResult.errors > 0
                      ? "bg-destructive/10 text-destructive"
                      : "bg-green-500/10 text-green-600"
                  }`}
                >
                  <p className="font-medium">
                    Sincronizacao {syncResult.errors > 0 ? "parcial" : "completa"}
                  </p>
                  <p className="text-sm mt-1">
                    {syncResult.synced} produtos sincronizados de{" "}
                    {syncResult.total} encontrados
                    {syncResult.errors > 0 &&
                      ` · ${syncResult.errors} erros`}
                  </p>
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                Clique em &quot;Sincronizar VNDA&quot; para importar todos os
                produtos da loja. O catalogo e atualizado automaticamente via
                webhook quando produtos sao criados ou editados na VNDA.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Performance por Prateleira (30 dias)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {analytics?.shelves && analytics.shelves.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium">Prateleira</th>
                        <th className="pb-2 font-medium">Pagina</th>
                        <th className="pb-2 font-medium">Algoritmo</th>
                        <th className="pb-2 font-medium text-right">
                          Impressoes
                        </th>
                        <th className="pb-2 font-medium text-right">
                          Cliques
                        </th>
                        <th className="pb-2 font-medium text-right">CTR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.shelves.map((shelf) => (
                        <tr
                          key={shelf.id}
                          className="border-b last:border-0"
                        >
                          <td className="py-2 font-medium">{shelf.title}</td>
                          <td className="py-2">
                            {PAGE_TYPE_LABELS[shelf.page_type] ||
                              shelf.page_type}
                          </td>
                          <td className="py-2">
                            {ALGORITHM_LABELS[shelf.algorithm] ||
                              shelf.algorithm}
                          </td>
                          <td className="py-2 text-right">
                            {formatNumber(shelf.impressions)}
                          </td>
                          <td className="py-2 text-right">
                            {formatNumber(shelf.clicks)}
                          </td>
                          <td className="py-2 text-right">{shelf.ctr}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Nenhum dado de analytics ainda. Os dados aparecem apos o
                  script ser instalado na loja.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Installation Tab */}
        <TabsContent value="install" className="space-y-4 mt-4">
          {/* API Keys */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Key className="h-5 w-5" />
                  API Keys
                </CardTitle>
                {apiKeys.length === 0 && (
                  <Button onClick={handleCreateApiKey} size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    Gerar API Key
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {apiKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma API key criada. Gere uma para instalar o script na
                  loja.
                </p>
              ) : (
                <div className="space-y-2">
                  {apiKeys.map((k) => (
                    <div
                      key={k.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                        {k.key}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(k.key)}
                      >
                        {copiedKey === k.key ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* GTM Snippet */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Snippet GTM</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                Adicione este script no Google Tag Manager para carregar as
                prateleiras na loja. Substitua o snippet do SmartHint.
              </p>
              {apiKeys.length > 0 ? (
                <div className="relative">
                  <pre className="rounded-lg bg-muted p-4 text-xs overflow-x-auto">
                    {`<script>
var _shelvesKey = "${apiKeys[0]?.key || "SUA_API_KEY"}";
(function(){var s=document.createElement('script');s.async=true;
s.src='${typeof window !== "undefined" ? window.location.origin : "https://SEU_DOMINIO"}/shelves.js';
document.head.appendChild(s)})();
</script>`}
                  </pre>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() =>
                      copyToClipboard(
                        `<script>\nvar _shelvesKey = "${apiKeys[0]?.key || "SUA_API_KEY"}";\n(function(){var s=document.createElement('script');s.async=true;\ns.src='${typeof window !== "undefined" ? window.location.origin : "https://SEU_DOMINIO"}/shelves.js';\ndocument.head.appendChild(s)})();\n</script>`
                      )
                    }
                  >
                    {copiedKey?.includes("_shelvesKey") ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-amber-500">
                  Gere uma API key acima para ver o snippet completo.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- Shelf Config Form ---

function ShelfConfigForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: ShelfConfig | null;
  onSubmit: (data: {
    page_type: string;
    position: number;
    algorithm: string;
    title: string;
    max_products: number;
    anchor_selector: string;
  }) => void;
  onCancel: () => void;
}) {
  const [pageType, setPageType] = useState(initial?.page_type || "home");
  const [position, setPosition] = useState(String(initial?.position || "1"));
  const [algorithm, setAlgorithm] = useState(
    initial?.algorithm || "bestsellers"
  );
  const [title, setTitle] = useState(initial?.title || "");
  const [maxProducts, setMaxProducts] = useState(
    String(initial?.max_products || 12)
  );
  const [anchorSelector, setAnchorSelector] = useState(
    initial?.anchor_selector || ""
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      page_type: pageType,
      position: parseInt(position, 10),
      algorithm,
      title: title || ALGORITHM_LABELS[algorithm] || algorithm,
      max_products: parseInt(maxProducts, 10) || 12,
      anchor_selector: anchorSelector || "",
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Pagina</Label>
          <Select value={pageType} onValueChange={setPageType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_TYPES.map((pt) => (
                <SelectItem key={pt.value} value={pt.value}>
                  {pt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Posicao</Label>
          <Input
            type="number"
            min="1"
            max="10"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Algoritmo</Label>
        <Select value={algorithm} onValueChange={setAlgorithm}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALGORITHMS.map((a) => (
              <SelectItem key={a.value} value={a.value}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Titulo da prateleira</Label>
        <Input
          placeholder={ALGORITHM_LABELS[algorithm] || "Titulo"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Max. produtos</Label>
          <Input
            type="number"
            min="4"
            max="50"
            value={maxProducts}
            onChange={(e) => setMaxProducts(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>
            Seletor CSS{" "}
            <span className="text-muted-foreground">(opcional)</span>
          </Label>
          <Input
            placeholder={`#smarthint-position-${position}`}
            value={anchorSelector}
            onChange={(e) => setAnchorSelector(e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">
          {initial ? "Salvar" : "Criar"}
        </Button>
      </div>
    </form>
  );
}
