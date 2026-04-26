"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Tag,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Check,
  Key,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkspace } from "@/lib/workspace-context";
import Link from "next/link";

// --- Types ---

interface PromoTagRule {
  id?: string;
  enabled: boolean;
  name: string;
  priority: number;
  match_type: "tag" | "category" | "name_pattern" | "product_ids";
  match_value: string;
  badge_text: string;
  badge_bg_color: string;
  badge_text_color: string;
  badge_font_size: string;
  badge_border_radius: string;
  badge_position: string;
  badge_padding: string;
  show_on_pages: string[];
  badge_type?: "static" | "cashback" | "viewers";
  badge_placement?: "auto" | "pdp_price" | "pdp_above_buy" | "card_overlay";
  viewers_min?: number;
  viewers_max?: number;
}

const EMPTY_RULE: PromoTagRule = {
  enabled: true,
  name: "",
  priority: 0,
  match_type: "tag",
  match_value: "",
  badge_text: "",
  badge_bg_color: "#ff0000",
  badge_text_color: "#ffffff",
  badge_font_size: "11px",
  badge_border_radius: "4px",
  badge_position: "top-left",
  badge_padding: "4px 8px",
  show_on_pages: ["all"],
  badge_type: "static",
  badge_placement: "auto",
  viewers_min: 6,
  viewers_max: 42,
};

const BADGE_TYPE_LABELS: Record<string, string> = {
  static: "Estática (texto fixo)",
  cashback: "Cashback (calculado por preço)",
  viewers: "Visualizações ao vivo",
};

const BADGE_TYPE_HELP: Record<string, string> = {
  static: "Texto fixo, igual o que a regra padrão sempre fez.",
  cashback:
    "Aparece somente na página do produto, próximo ao preço. Use {cashback} no texto pra ser substituído pelo valor (ex: Ganhe {cashback} em cashback).",
  viewers:
    "Aparece somente na PDP. Use {viewers} no texto pra ser substituído pelo número (ex: {viewers} pessoas vendo este produto). O valor varia por horário/popularidade do produto.",
};

const MATCH_TYPE_LABELS: Record<string, string> = {
  tag: "Tag VNDA",
  category: "Categoria",
  name_pattern: "Padrão no nome",
  product_ids: "IDs específicos",
};

const MATCH_TYPE_HELP: Record<string, string> = {
  tag: "Use o nome exato da tag na VNDA (ex: Camisetas)",
  category: "Nome da categoria do produto (ex: Roupas)",
  name_pattern: "Use * como coringa (ex: Kit* ou *Camiseta*)",
  product_ids: "IDs separados por vírgula (ex: 12345, 67890)",
};

const POSITION_LABELS: Record<string, string> = {
  "top-left": "Topo Esquerdo",
  "top-right": "Topo Direito",
  "bottom-left": "Base Esquerda",
  "bottom-right": "Base Direita",
};

const PAGE_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "home", label: "Home" },
  { value: "product", label: "Produto" },
  { value: "category", label: "Categoria" },
  { value: "cart", label: "Carrinho" },
];

// --- Component ---

export default function PromoTagsPage() {
  const { workspace } = useWorkspace();
  const [rules, setRules] = useState<PromoTagRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<PromoTagRule>(EMPTY_RULE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "x-workspace-id": workspace?.id || "",
    }),
    [workspace?.id]
  );

  const loadRules = useCallback(async () => {
    if (!workspace?.id) return;
    try {
      const res = await fetch("/api/promo-tags/config", { headers: headers() });
      const data = await res.json();
      setRules(data.rules || []);
    } catch (err) {
      console.error("Failed to load promo tag rules:", err);
    }
  }, [workspace?.id, headers]);

  const loadApiKeys = useCallback(async () => {
    if (!workspace?.id) return;
    try {
      const res = await fetch("/api/shelves/api-keys", { headers: headers() });
      const data = await res.json();
      setHasApiKey((data.keys || []).length > 0);
    } catch {
      // ignore
    }
  }, [workspace?.id, headers]);

  useEffect(() => {
    if (workspace?.id) {
      Promise.all([loadRules(), loadApiKeys()]).finally(() =>
        setLoading(false)
      );
    }
  }, [workspace?.id, loadRules, loadApiKeys]);

  function openCreate() {
    setEditingRule(EMPTY_RULE);
    setEditingId(null);
    setDialogOpen(true);
  }

  function openEdit(rule: PromoTagRule) {
    setEditingRule({ ...rule });
    setEditingId(rule.id || null);
    setDialogOpen(true);
  }

  async function handleSyncCatalog() {
    if (!workspace?.id || syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/shelves/catalog/sync", {
        method: "POST",
        headers: headers(),
      });
      const data = await res.json();
      if (data.error) {
        setSyncMsg(`Erro: ${data.error}`);
      } else {
        setSyncMsg(
          `Sincronizado ${data.synced}/${data.total} produtos${data.errors ? ` (${data.errors} erros)` : ""}. As tags atualizadas aparecem na loja em ate 5 minutos.`
        );
      }
    } catch (err) {
      setSyncMsg(`Erro de rede: ${err instanceof Error ? err.message : "desconhecido"}`);
    } finally {
      setSyncing(false);
    }
  }

  async function handleSave() {
    if (!workspace?.id) return;
    setSaving(true);
    try {
      if (editingId) {
        // Update
        const res = await fetch(`/api/promo-tags/config/${editingId}`, {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify(editingRule),
        });
        if (!res.ok) throw new Error("Failed to update");
      } else {
        // Create
        const res = await fetch("/api/promo-tags/config", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(editingRule),
        });
        if (!res.ok) throw new Error("Failed to create");
      }
      setDialogOpen(false);
      await loadRules();
    } catch (err) {
      console.error("Failed to save promo tag rule:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!workspace?.id) return;
    try {
      await fetch(`/api/promo-tags/config/${id}`, {
        method: "DELETE",
        headers: headers(),
      });
      await loadRules();
    } catch (err) {
      console.error("Failed to delete promo tag rule:", err);
    }
  }

  async function handleToggle(rule: PromoTagRule) {
    if (!rule.id) return;
    try {
      await fetch(`/api/promo-tags/config/${rule.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      await loadRules();
    } catch (err) {
      console.error("Failed to toggle promo tag rule:", err);
    }
  }

  function updateEditing(partial: Partial<PromoTagRule>) {
    setEditingRule((prev) => ({ ...prev, ...partial }));
  }

  function togglePage(page: string) {
    setEditingRule((prev) => {
      const current = prev.show_on_pages;
      if (page === "all") return { ...prev, show_on_pages: ["all"] };
      let next = current.filter((p) => p !== "all");
      if (next.includes(page)) {
        next = next.filter((p) => p !== page);
      } else {
        next.push(page);
      }
      if (next.length === 0) next = ["all"];
      return { ...prev, show_on_pages: next };
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Tag className="h-6 w-6" />
          <div>
            <h1 className="text-2xl font-bold">Etiquetas Promocionais</h1>
            <p className="text-sm text-muted-foreground">
              Badges promocionais nos cards de produto da loja
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleSyncCatalog}
            disabled={syncing}
            title="Reimporta tags e produtos da VNDA — use quando criar uma tag nova e ela ainda nao aparecer aqui"
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sincronizar catalogo
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Nova Regra
          </Button>
        </div>
      </div>

      {syncMsg && (
        <div
          className={`text-sm rounded-md border p-3 flex items-start gap-2 ${
            syncMsg.startsWith("Erro")
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : "border-green-500/30 bg-green-500/10 text-green-500"
          }`}
        >
          <div className="flex-1">{syncMsg}</div>
          <button
            onClick={() => setSyncMsg(null)}
            className="opacity-60 hover:opacity-100"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
      )}

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Regras</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="install">Instalação</TabsTrigger>
        </TabsList>

        {/* ======================== TAB: RULES ======================== */}
        <TabsContent value="rules" className="space-y-4">
          {rules.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Tag className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p>Nenhuma regra configurada.</p>
                <p className="text-sm mt-1">
                  Crie uma regra para exibir badges nos produtos da loja.
                </p>
                <Button variant="outline" className="mt-4" onClick={openCreate}>
                  <Plus className="h-4 w-4 mr-2" />
                  Criar regra
                </Button>
              </CardContent>
            </Card>
          ) : (
            rules.map((rule) => (
              <Card key={rule.id}>
                <CardContent className="flex items-center gap-4 py-4">
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={() => handleToggle(rule)}
                  />

                  {/* Badge preview */}
                  <div
                    className="shrink-0 font-bold uppercase text-center"
                    style={{
                      backgroundColor: rule.badge_bg_color,
                      color: rule.badge_text_color,
                      fontSize: rule.badge_font_size,
                      borderRadius: rule.badge_border_radius,
                      padding: rule.badge_padding,
                    }}
                  >
                    {rule.badge_text}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{rule.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {MATCH_TYPE_LABELS[rule.match_type]}:{" "}
                      <span className="font-mono">{rule.match_value}</span>
                      {rule.priority > 0 && (
                        <span className="ml-2">
                          Prioridade: {rule.priority}
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(rule)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => rule.id && handleDelete(rule.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* ======================== TAB: PREVIEW ======================== */}
        <TabsContent value="preview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Preview dos Badges
              </CardTitle>
            </CardHeader>
            <CardContent>
              {rules.filter((r) => r.enabled).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma regra ativa para mostrar no preview.
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {rules
                    .filter((r) => r.enabled)
                    .map((rule) => (
                      <div
                        key={rule.id}
                        className="relative border rounded-lg overflow-hidden"
                      >
                        {/* Mock product image */}
                        <div className="relative bg-muted aspect-square flex items-center justify-center">
                          <span className="text-4xl opacity-20">T</span>
                          {/* Badge */}
                          <div
                            className="absolute font-bold uppercase"
                            style={{
                              backgroundColor: rule.badge_bg_color,
                              color: rule.badge_text_color,
                              fontSize: rule.badge_font_size,
                              borderRadius: rule.badge_border_radius,
                              padding: rule.badge_padding,
                              ...(rule.badge_position.includes("top")
                                ? { top: 8 }
                                : { bottom: 8 }),
                              ...(rule.badge_position.includes("left")
                                ? { left: 8 }
                                : { right: 8 }),
                            }}
                          >
                            {rule.badge_text}
                          </div>
                        </div>
                        {/* Mock product info */}
                        <div className="p-2">
                          <p className="text-xs font-medium truncate">
                            Produto exemplo
                          </p>
                          <p className="text-xs text-muted-foreground">
                            R$ 69,90
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ======================== TAB: INSTALL ======================== */}
        <TabsContent value="install" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Key className="h-4 w-4" />
                Status da Integração
              </CardTitle>
            </CardHeader>
            <CardContent>
              {hasApiKey ? (
                <div className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-green-600 mt-0.5" />
                  <div>
                    <p className="font-medium">Integração pronta</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      As etiquetas promocionais usam a mesma API key e script
                      das Prateleiras Inteligentes. Nenhuma configuração
                      adicional é necessária — basta criar regras e elas
                      aparecerão automaticamente nos produtos da loja.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <Key className="h-5 w-5 text-amber-500 mt-0.5" />
                  <div>
                    <p className="font-medium">API key necessária</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Você precisa criar uma API key e instalar o script das
                      Prateleiras na loja antes de usar as etiquetas.
                    </p>
                    <Button variant="outline" size="sm" className="mt-3" asChild>
                      <Link href="/shelves">
                        <ExternalLink className="h-3 w-3 mr-2" />
                        Ir para Prateleiras
                      </Link>
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Como funciona</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                As etiquetas promocionais são carregadas automaticamente pelo
                mesmo script das Prateleiras Inteligentes (
                <code>shelves.js</code>).
              </p>
              <p>
                O script identifica os cards de produto na loja, consulta quais
                produtos correspondem às regras configuradas e insere os badges
                visuais nos cards.
              </p>
              <p>
                Produtos carregados dinamicamente (infinite scroll, AJAX) também
                recebem os badges automaticamente.
              </p>
              <p className="text-amber-600">
                Os produtos precisam estar sincronizados no catálogo (em
                Prateleiras &gt; Catálogo) para que a identificação por tag e
                categoria funcione.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ======================== DIALOG: CREATE/EDIT RULE ======================== */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Editar Regra" : "Nova Regra"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-2">
              <Label>Nome da regra</Label>
              <Input
                value={editingRule.name}
                onChange={(e) => updateEditing({ name: e.target.value })}
                placeholder="Ex: Promoção Camisetas Verão"
              />
            </div>

            {/* Match type + value */}
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label>Tipo de filtro</Label>
                <Select
                  value={editingRule.match_type}
                  onValueChange={(v) =>
                    updateEditing({
                      match_type: v as PromoTagRule["match_type"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(MATCH_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Valor do filtro</Label>
                <Input
                  value={editingRule.match_value}
                  onChange={(e) =>
                    updateEditing({ match_value: e.target.value })
                  }
                  placeholder={
                    editingRule.match_type === "tag"
                      ? "Ex: Camisetas"
                      : editingRule.match_type === "category"
                        ? "Ex: Roupas"
                        : editingRule.match_type === "name_pattern"
                          ? "Ex: Kit* ou *Camiseta*"
                          : "Ex: 12345, 67890"
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {MATCH_TYPE_HELP[editingRule.match_type]}
                </p>
              </div>
            </div>

            {/* Badge type */}
            <div className="space-y-2">
              <Label>Tipo de badge</Label>
              <Select
                value={editingRule.badge_type || "static"}
                onValueChange={(v) =>
                  updateEditing({ badge_type: v as PromoTagRule["badge_type"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(BADGE_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {BADGE_TYPE_HELP[editingRule.badge_type || "static"]}
              </p>
            </div>

            {/* Badge text */}
            <div className="space-y-2">
              <Label>Texto do badge</Label>
              <Input
                value={editingRule.badge_text}
                onChange={(e) =>
                  updateEditing({ badge_text: e.target.value })
                }
                placeholder={
                  editingRule.badge_type === "cashback"
                    ? "Ganhe {cashback} em cashback ({percent}%)"
                    : editingRule.badge_type === "viewers"
                    ? "{viewers} pessoas vendo este produto"
                    : "Ex: LEVE 5 POR 349"
                }
              />
              {editingRule.badge_type === "cashback" && (
                <p className="text-xs text-muted-foreground">
                  Use <code className="bg-muted px-1 rounded">{"{cashback}"}</code> e
                  <code className="bg-muted px-1 rounded ml-1">{"{percent}"}</code> como placeholders.
                </p>
              )}
              {editingRule.badge_type === "viewers" && (
                <p className="text-xs text-muted-foreground">
                  Use <code className="bg-muted px-1 rounded">{"{viewers}"}</code> como placeholder do número.
                </p>
              )}
            </div>

            {/* Viewers range — only when type=viewers */}
            {editingRule.badge_type === "viewers" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Mínimo de viewers</Label>
                  <Input
                    type="number"
                    min={1}
                    value={editingRule.viewers_min ?? 6}
                    onChange={(e) =>
                      updateEditing({
                        viewers_min: Math.max(1, parseInt(e.target.value) || 1),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Máximo de viewers</Label>
                  <Input
                    type="number"
                    min={1}
                    value={editingRule.viewers_max ?? 42}
                    onChange={(e) =>
                      updateEditing({
                        viewers_max: Math.max(1, parseInt(e.target.value) || 1),
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Sugestão: 6–42 evita parecer fake; o servidor calibra pelo horário e popularidade do produto.
                  </p>
                </div>
              </div>
            )}

            {/* Priority */}
            <div className="space-y-2">
              <Label>Prioridade</Label>
              <Input
                type="number"
                min={0}
                value={editingRule.priority}
                onChange={(e) =>
                  updateEditing({ priority: parseInt(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-muted-foreground">
                Maior = aparece primeiro quando um produto dá match em múltiplas regras
              </p>
            </div>

            {/* Position */}
            <div className="space-y-2">
              <Label>Posição do badge</Label>
              <Select
                value={editingRule.badge_position}
                onValueChange={(v) => updateEditing({ badge_position: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(POSITION_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Colors */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cor do fundo</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={editingRule.badge_bg_color}
                    onChange={(e) =>
                      updateEditing({ badge_bg_color: e.target.value })
                    }
                    className="w-8 h-8 rounded border cursor-pointer"
                  />
                  <Input
                    value={editingRule.badge_bg_color}
                    onChange={(e) =>
                      updateEditing({ badge_bg_color: e.target.value })
                    }
                    className="font-mono text-xs"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Cor do texto</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={editingRule.badge_text_color}
                    onChange={(e) =>
                      updateEditing({ badge_text_color: e.target.value })
                    }
                    className="w-8 h-8 rounded border cursor-pointer"
                  />
                  <Input
                    value={editingRule.badge_text_color}
                    onChange={(e) =>
                      updateEditing({ badge_text_color: e.target.value })
                    }
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Font size + border radius */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tamanho da fonte</Label>
                <Select
                  value={editingRule.badge_font_size}
                  onValueChange={(v) => updateEditing({ badge_font_size: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="9px">9px</SelectItem>
                    <SelectItem value="10px">10px</SelectItem>
                    <SelectItem value="11px">11px</SelectItem>
                    <SelectItem value="12px">12px</SelectItem>
                    <SelectItem value="13px">13px</SelectItem>
                    <SelectItem value="14px">14px</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Borda arredondada</Label>
                <Select
                  value={editingRule.badge_border_radius}
                  onValueChange={(v) =>
                    updateEditing({ badge_border_radius: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0px">Sem borda</SelectItem>
                    <SelectItem value="2px">2px</SelectItem>
                    <SelectItem value="4px">4px</SelectItem>
                    <SelectItem value="8px">8px</SelectItem>
                    <SelectItem value="16px">Pílula</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Pages */}
            <div className="space-y-2">
              <Label>Exibir em</Label>
              <div className="flex flex-wrap gap-2">
                {PAGE_OPTIONS.map((p) => (
                  <Badge
                    key={p.value}
                    variant={
                      editingRule.show_on_pages.includes(p.value)
                        ? "default"
                        : "outline"
                    }
                    className="cursor-pointer"
                    onClick={() => togglePage(p.value)}
                  >
                    {p.label}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Live badge preview */}
            <div className="space-y-2">
              <Label>Preview</Label>
              <div className="flex items-center justify-center py-4 bg-muted rounded-lg">
                {editingRule.badge_text ? (
                  <div
                    className="font-bold uppercase"
                    style={{
                      backgroundColor: editingRule.badge_bg_color,
                      color: editingRule.badge_text_color,
                      fontSize: editingRule.badge_font_size,
                      borderRadius: editingRule.badge_border_radius,
                      padding: editingRule.badge_padding,
                    }}
                  >
                    {editingRule.badge_text}
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Digite o texto do badge para ver o preview
                  </span>
                )}
              </div>
            </div>

            {/* Save */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={
                  saving ||
                  !editingRule.name ||
                  !editingRule.match_value ||
                  !editingRule.badge_text
                }
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                {editingId ? "Salvar" : "Criar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
