"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Gift,
  Save,
  Loader2,
  Check,
  Key,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";
import Link from "next/link";

// --- Types ---

interface GiftBarConfig {
  id?: string;
  workspace_id?: string;
  enabled: boolean;
  threshold: number;
  gift_name: string;
  gift_description: string;
  gift_image_url: string;
  message_progress: string;
  message_achieved: string;
  message_empty: string;
  bar_color: string;
  bar_bg_color: string;
  text_color: string;
  bg_color: string;
  achieved_bg_color: string;
  achieved_text_color: string;
  font_size: string;
  bar_height: string;
  position: string;
  show_on_pages: string[];
}

const DEFAULT_CONFIG: GiftBarConfig = {
  enabled: false,
  threshold: 299,
  gift_name: "brinde exclusivo",
  gift_description: "",
  gift_image_url: "",
  message_progress: "Faltam R$ {remaining} para ganhar {gift}!",
  message_achieved: "Parabéns! Você ganhou {gift}!",
  message_empty: "Adicione R$ {threshold} em produtos e ganhe {gift}!",
  bar_color: "#10b981",
  bar_bg_color: "#e5e7eb",
  text_color: "#1f2937",
  bg_color: "#ffffff",
  achieved_bg_color: "#ecfdf5",
  achieved_text_color: "#065f46",
  font_size: "14px",
  bar_height: "8px",
  position: "top",
  show_on_pages: ["all"],
};

const PAGE_OPTIONS = [
  { value: "all", label: "Todas as páginas" },
  { value: "home", label: "Home" },
  { value: "product", label: "Produto" },
  { value: "category", label: "Categoria" },
  { value: "cart", label: "Carrinho" },
];

// --- Component ---

export default function GiftBarPage() {
  const { workspace } = useWorkspace();
  const [config, setConfig] = useState<GiftBarConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [previewCart, setPreviewCart] = useState(150);

  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "x-workspace-id": workspace?.id || "",
    }),
    [workspace?.id]
  );

  const loadConfig = useCallback(async () => {
    if (!workspace?.id) return;
    try {
      const res = await fetch("/api/gift-bar/config", { headers: headers() });
      const data = await res.json();
      if (data.config) {
        setConfig(data.config);
      }
    } catch (err) {
      console.error("Failed to load gift bar config:", err);
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
      Promise.all([loadConfig(), loadApiKeys()]).finally(() =>
        setLoading(false)
      );
    }
  }, [workspace?.id, loadConfig, loadApiKeys]);

  async function handleSave() {
    if (!workspace?.id) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/gift-bar/config", {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (data.config) {
        setConfig(data.config);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      console.error("Failed to save gift bar config:", err);
    } finally {
      setSaving(false);
    }
  }

  function updateConfig(partial: Partial<GiftBarConfig>) {
    setConfig((prev) => ({ ...prev, ...partial }));
  }

  function togglePage(page: string) {
    setConfig((prev) => {
      const current = prev.show_on_pages;
      if (page === "all") {
        return { ...prev, show_on_pages: ["all"] };
      }
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

  // --- Preview helpers ---

  function interpolateMessage(template: string, cartTotal: number) {
    const remaining = Math.max(config.threshold - cartTotal, 0);
    return template
      .replace(/\{remaining\}/g, formatBRL(remaining))
      .replace(/\{threshold\}/g, formatBRL(config.threshold))
      .replace(/\{gift\}/g, config.gift_name)
      .replace(/\{total\}/g, formatBRL(cartTotal));
  }

  function formatBRL(value: number) {
    return value.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function getPreviewMessage(cartTotal: number) {
    if (cartTotal <= 0) return interpolateMessage(config.message_empty, 0);
    if (cartTotal >= config.threshold)
      return interpolateMessage(config.message_achieved, cartTotal);
    return interpolateMessage(config.message_progress, cartTotal);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pct = Math.min((previewCart / config.threshold) * 100, 100);
  const achieved = previewCart >= config.threshold;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Gift className="h-6 w-6" />
          <div>
            <h1 className="text-2xl font-bold">Régua de Brinde</h1>
            <p className="text-sm text-muted-foreground">
              Barra de progresso que incentiva o aumento do ticket médio
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              checked={config.enabled}
              onCheckedChange={(v) => updateConfig({ enabled: v })}
            />
            <Badge variant={config.enabled ? "default" : "secondary"}>
              {config.enabled ? "Ativo" : "Inativo"}
            </Badge>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : saved ? (
              <Check className="h-4 w-4 mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {saved ? "Salvo!" : "Salvar"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">Configuração</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="install">Instalação</TabsTrigger>
        </TabsList>

        {/* ======================== TAB: CONFIG ======================== */}
        <TabsContent value="config" className="space-y-6">
          {/* Gift settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Configuração do Brinde</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Valor mínimo (R$)</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={config.threshold}
                    onChange={(e) =>
                      updateConfig({ threshold: parseFloat(e.target.value) || 0 })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Valor do carrinho para ganhar o brinde
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Nome do brinde</Label>
                  <Input
                    value={config.gift_name}
                    onChange={(e) =>
                      updateConfig({ gift_name: e.target.value })
                    }
                    placeholder="Ex: necessaire premium"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Descrição (opcional)</Label>
                <Textarea
                  value={config.gift_description}
                  onChange={(e) =>
                    updateConfig({ gift_description: e.target.value })
                  }
                  placeholder="Descrição curta do brinde"
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label>URL da imagem (opcional)</Label>
                <Input
                  value={config.gift_image_url}
                  onChange={(e) =>
                    updateConfig({ gift_image_url: e.target.value })
                  }
                  placeholder="https://cdn.vnda.com.br/..."
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Posição</Label>
                  <Select
                    value={config.position}
                    onValueChange={(v) => updateConfig({ position: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="top">Topo da página</SelectItem>
                      <SelectItem value="bottom">Rodapé fixo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Exibir em</Label>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {PAGE_OPTIONS.map((p) => (
                      <Badge
                        key={p.value}
                        variant={
                          config.show_on_pages.includes(p.value)
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
              </div>
            </CardContent>
          </Card>

          {/* Messages */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mensagens</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Placeholders disponíveis:{" "}
                <code className="bg-muted px-1 rounded">{"{gift}"}</code>{" "}
                <code className="bg-muted px-1 rounded">{"{remaining}"}</code>{" "}
                <code className="bg-muted px-1 rounded">{"{threshold}"}</code>{" "}
                <code className="bg-muted px-1 rounded">{"{total}"}</code>
              </p>

              <div className="space-y-2">
                <Label>Carrinho vazio</Label>
                <Input
                  value={config.message_empty}
                  onChange={(e) =>
                    updateConfig({ message_empty: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Em progresso</Label>
                <Input
                  value={config.message_progress}
                  onChange={(e) =>
                    updateConfig({ message_progress: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Brinde conquistado</Label>
                <Input
                  value={config.message_achieved}
                  onChange={(e) =>
                    updateConfig({ message_achieved: e.target.value })
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* Appearance */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Aparência</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Cor da barra</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={config.bar_color}
                      onChange={(e) =>
                        updateConfig({ bar_color: e.target.value })
                      }
                      className="w-8 h-8 rounded border cursor-pointer"
                    />
                    <Input
                      value={config.bar_color}
                      onChange={(e) =>
                        updateConfig({ bar_color: e.target.value })
                      }
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Fundo da barra</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={config.bar_bg_color}
                      onChange={(e) =>
                        updateConfig({ bar_bg_color: e.target.value })
                      }
                      className="w-8 h-8 rounded border cursor-pointer"
                    />
                    <Input
                      value={config.bar_bg_color}
                      onChange={(e) =>
                        updateConfig({ bar_bg_color: e.target.value })
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
                      value={config.text_color}
                      onChange={(e) =>
                        updateConfig({ text_color: e.target.value })
                      }
                      className="w-8 h-8 rounded border cursor-pointer"
                    />
                    <Input
                      value={config.text_color}
                      onChange={(e) =>
                        updateConfig({ text_color: e.target.value })
                      }
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Fundo normal</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={config.bg_color}
                      onChange={(e) =>
                        updateConfig({ bg_color: e.target.value })
                      }
                      className="w-8 h-8 rounded border cursor-pointer"
                    />
                    <Input
                      value={config.bg_color}
                      onChange={(e) =>
                        updateConfig({ bg_color: e.target.value })
                      }
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Fundo conquistado</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={config.achieved_bg_color}
                      onChange={(e) =>
                        updateConfig({ achieved_bg_color: e.target.value })
                      }
                      className="w-8 h-8 rounded border cursor-pointer"
                    />
                    <Input
                      value={config.achieved_bg_color}
                      onChange={(e) =>
                        updateConfig({ achieved_bg_color: e.target.value })
                      }
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Texto conquistado</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={config.achieved_text_color}
                      onChange={(e) =>
                        updateConfig({ achieved_text_color: e.target.value })
                      }
                      className="w-8 h-8 rounded border cursor-pointer"
                    />
                    <Input
                      value={config.achieved_text_color}
                      onChange={(e) =>
                        updateConfig({ achieved_text_color: e.target.value })
                      }
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Altura da barra</Label>
                  <Select
                    value={config.bar_height}
                    onValueChange={(v) => updateConfig({ bar_height: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="4px">Fina (4px)</SelectItem>
                      <SelectItem value="6px">Média (6px)</SelectItem>
                      <SelectItem value="8px">Grossa (8px)</SelectItem>
                      <SelectItem value="10px">Extra (10px)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Tamanho da fonte</Label>
                  <Select
                    value={config.font_size}
                    onValueChange={(v) => updateConfig({ font_size: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="12px">Pequena (12px)</SelectItem>
                      <SelectItem value="14px">Média (14px)</SelectItem>
                      <SelectItem value="16px">Grande (16px)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ======================== TAB: PREVIEW ======================== */}
        <TabsContent value="preview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preview Interativo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>
                  Valor simulado do carrinho: R${" "}
                  {formatBRL(previewCart)}
                </Label>
                <input
                  type="range"
                  min={0}
                  max={config.threshold * 1.5 || 500}
                  step={1}
                  value={previewCart}
                  onChange={(e) => setPreviewCart(Number(e.target.value))}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>R$ 0,00</span>
                  <span>R$ {formatBRL(config.threshold)} (meta)</span>
                  <span>
                    R$ {formatBRL(config.threshold * 1.5)}
                  </span>
                </div>
              </div>

              {/* Live preview */}
              <div className="rounded-lg border overflow-hidden">
                <div
                  style={{
                    background: achieved
                      ? config.achieved_bg_color
                      : config.bg_color,
                    color: achieved
                      ? config.achieved_text_color
                      : config.text_color,
                    padding: "10px 16px",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: config.font_size,
                  }}
                >
                  <div
                    style={{
                      maxWidth: 1200,
                      margin: "0 auto",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    {config.gift_image_url && (
                      <img
                        src={config.gift_image_url}
                        alt={config.gift_name}
                        style={{
                          width: 32,
                          height: 32,
                          objectFit: "contain",
                          borderRadius: 4,
                        }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    )}
                    <div style={{ flex: 1 }}>
                      <p
                        style={{
                          margin: "0 0 6px",
                          fontWeight: 600,
                          textAlign: "center",
                        }}
                      >
                        {getPreviewMessage(previewCart)}
                      </p>
                      <div
                        style={{
                          width: "100%",
                          height: config.bar_height,
                          background: config.bar_bg_color,
                          borderRadius: 999,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            background: config.bar_color,
                            borderRadius: 999,
                            transition: "width 0.5s ease",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* State indicators */}
              <div className="grid grid-cols-3 gap-4 text-center text-sm">
                <div
                  className={`rounded-lg border p-3 ${
                    previewCart <= 0 ? "ring-2 ring-primary" : ""
                  }`}
                >
                  <p className="font-medium">Carrinho vazio</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {interpolateMessage(config.message_empty, 0)}
                  </p>
                </div>
                <div
                  className={`rounded-lg border p-3 ${
                    previewCart > 0 && previewCart < config.threshold
                      ? "ring-2 ring-primary"
                      : ""
                  }`}
                >
                  <p className="font-medium">Em progresso</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {interpolateMessage(
                      config.message_progress,
                      config.threshold / 2
                    )}
                  </p>
                </div>
                <div
                  className={`rounded-lg border p-3 ${
                    achieved ? "ring-2 ring-primary" : ""
                  }`}
                >
                  <p className="font-medium">Conquistado</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {interpolateMessage(
                      config.message_achieved,
                      config.threshold
                    )}
                  </p>
                </div>
              </div>
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
                      A régua de brinde usa a mesma API key e script das
                      Prateleiras Inteligentes. Nenhuma configuração adicional é
                      necessária — basta ativar a régua e ela aparecerá
                      automaticamente na loja.
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
                      Prateleiras na loja antes de usar a régua de brinde.
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
                A régua de brinde é carregada automaticamente pelo mesmo script
                das Prateleiras Inteligentes (<code>shelves.js</code>).
              </p>
              <p>
                Quando ativa, ela aparece no topo (ou rodapé) de todas as páginas
                da loja, lendo o valor do carrinho do cliente em tempo real e
                mostrando quanto falta para atingir o valor mínimo configurado.
              </p>
              <p>
                A barra se atualiza automaticamente quando o cliente adiciona ou
                remove produtos do carrinho.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
