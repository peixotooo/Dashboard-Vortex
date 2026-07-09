"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Eye,
  GripVertical,
  Link2,
  Loader2,
  MousePointerClick,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/lib/workspace-context";
import type { BioBlockConfig, BioBlockType, BioPageConfig, BioProductAlgorithm } from "@/lib/bio/types";

const ALGORITHMS: Array<{ value: BioProductAlgorithm; label: string }> = [
  { value: "bestsellers", label: "Mais vendidos" },
  { value: "bestseller_camisetas", label: "Camisetas mais vendidas" },
  { value: "offers", label: "Ofertas" },
  { value: "news", label: "Lancamentos" },
  { value: "most_popular", label: "Mais vistos" },
  { value: "custom_tags", label: "Tags VNDA" },
  { value: "price_range", label: "Faixa de preco" },
];

const BLOCK_TYPES: Array<{ value: BioBlockType; label: string }> = [
  { value: "hero", label: "Hero/oferta" },
  { value: "products", label: "Produtos" },
  { value: "categories", label: "Categorias" },
  { value: "chat", label: "Chat / Assistente" },
  { value: "group", label: "Grupo WhatsApp" },
  { value: "club", label: "Bulking Club" },
  { value: "shipping", label: "Frete/beneficio" },
  { value: "reviews", label: "Avaliacoes" },
];

type BioMetrics = {
  totals: {
    views: number;
    clicks: number;
    ctr: number;
  };
  by_event: Record<string, number>;
  top_blocks: Array<{ block_id: string; block_type: string | null; clicks: number }>;
  days: number;
};

function blockTypeLabel(type: string): string {
  return BLOCK_TYPES.find((item) => item.value === type)?.label || type;
}

function makeBlock(type: BioBlockType): BioBlockConfig {
  const id = `${type}-${Date.now().toString(36)}`;
  if (type === "products") {
    return {
      id,
      type,
      enabled: true,
      title: "Nova prateleira",
      subtitle: "",
      algorithm: "bestsellers",
      limit: 6,
      tags: [],
    };
  }
  if (type === "categories") {
    return {
      id,
      type,
      enabled: true,
      title: "Atalhos",
      subtitle: "",
      source: "automatic",
      items: [],
    };
  }
  if (type === "reviews") {
    return {
      id,
      type,
      enabled: true,
      title: "Avaliacoes",
      subtitle: "",
      limit: 5,
    };
  }
  if (type === "chat") {
    return {
      id,
      type,
      enabled: true,
      title: "Comprar pelo chat",
      subtitle: "Fale com o assistente e monte sua sacola em segundos.",
      cta_label: "Abrir chat",
      url: "https://chat.bulking.com.br",
      source: "manual",
    };
  }
  return {
    id,
    type,
    enabled: true,
    title: type === "hero" ? "Acao ativa" : "Novo bloco",
    subtitle: "",
    cta_label: "Conferir",
    url: "https://www.bulking.com.br",
    source: type === "hero" ? "active_topbar" : "manual",
    pool_slug: type === "group" ? "vip" : undefined,
  };
}

function itemsToText(block: BioBlockConfig): string {
  return (block.items || [])
    .map((item) => [item.label, item.url, item.description || ""].join("|"))
    .join("\n");
}

function textToItems(value: string) {
  return value
    .split("\n")
    .map((line, index) => {
      const [label, url, description] = line.split("|").map((part) => part?.trim() || "");
      if (!label || !url) return null;
      return {
        id: label
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || `cat-${index + 1}`,
        label,
        url,
        description,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

export default function BioInteligentePage() {
  const { workspace } = useWorkspace();
  const [config, setConfig] = useState<BioPageConfig | null>(null);
  const [metrics, setMetrics] = useState<BioMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newBlockType, setNewBlockType] = useState<BioBlockType>("products");
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);

  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "x-workspace-id": workspace?.id || "",
    }),
    [workspace?.id]
  );

  const publicUrl = useMemo(() => {
    if (!config?.public_domain) return "https://bio.bulking.com.br";
    return `https://${config.public_domain}`;
  }, [config?.public_domain]);

  const load = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    setError(null);
    try {
      const [configRes, metricsRes] = await Promise.all([
        fetch("/api/bio/config", { headers: headers() }),
        fetch("/api/bio/metrics?days=7", { headers: headers() }),
      ]);
      const configData = await configRes.json();
      const metricsData = await metricsRes.json();
      if (!configRes.ok) throw new Error(configData.error || "Erro ao carregar bio");
      const loadedConfig = configData.config as BioPageConfig;
      setConfig(loadedConfig);
      setExpandedBlockId((current) =>
        current && loadedConfig.blocks.some((block) => block.id === current)
          ? current
          : loadedConfig.blocks[0]?.id || null
      );
      setMetrics(metricsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, [workspace?.id, headers]);

  useEffect(() => {
    void load();
  }, [load]);

  function patchConfig(patch: Partial<BioPageConfig>) {
    setConfig((current) => (current ? { ...current, ...patch } : current));
  }

  function patchBlock(index: number, patch: Partial<BioBlockConfig>) {
    setConfig((current) => {
      if (!current) return current;
      const blocks = [...current.blocks];
      blocks[index] = { ...blocks[index], ...patch };
      return { ...current, blocks };
    });
  }

  function moveBlock(index: number, direction: -1 | 1) {
    setConfig((current) => {
      if (!current) return current;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.blocks.length) return current;
      const blocks = [...current.blocks];
      [blocks[index], blocks[nextIndex]] = [blocks[nextIndex], blocks[index]];
      return { ...current, blocks };
    });
  }

  function removeBlock(index: number) {
    const removedId = config?.blocks[index]?.id;
    const fallbackId = config?.blocks[index + 1]?.id || config?.blocks[index - 1]?.id || null;
    if (removedId && expandedBlockId === removedId) setExpandedBlockId(fallbackId);
    setConfig((current) => {
      if (!current) return current;
      return { ...current, blocks: current.blocks.filter((_, itemIndex) => itemIndex !== index) };
    });
  }

  function addBlock() {
    const block = makeBlock(newBlockType);
    setExpandedBlockId(block.id);
    setConfig((current) => {
      if (!current) return current;
      return { ...current, blocks: [...current.blocks, block] };
    });
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/bio/config", {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao salvar");
      setConfig(data.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!config) {
    return (
      <div>
        <h1 className="text-3xl font-bold">Bio inteligente</h1>
        <p className="mt-2 text-muted-foreground">{error || "Nao foi possivel carregar a configuracao."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link2 className="h-7 w-7" />
            <h1 className="text-3xl font-bold">Bio inteligente</h1>
          </div>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Mini storefront para o Instagram com produtos, campanhas, grupo VIP e tracking proprio.
          </p>
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-primary"
          >
            {publicUrl}
            <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
            <Switch checked={config.enabled} onCheckedChange={(enabled) => patchConfig({ enabled })} />
            <span className="text-sm font-semibold">{config.enabled ? "Ativa" : "Pausada"}</span>
          </div>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar
          </Button>
        </div>
      </div>

      {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Eye className="h-4 w-4" />
              Views 7d
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{metrics?.totals.views || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <MousePointerClick className="h-4 w-4" />
              Cliques 7d
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{metrics?.totals.clicks || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">CTR</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{(metrics?.totals.ctr || 0).toFixed(2)}%</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuracao geral</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Dominio publico</Label>
            <Input value={config.public_domain} onChange={(event) => patchConfig({ public_domain: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>URL base da loja</Label>
            <Input value={config.store_base_url} onChange={(event) => patchConfig({ store_base_url: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Nome da marca</Label>
            <Input value={config.brand_name} onChange={(event) => patchConfig({ brand_name: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Campanha UTM padrao</Label>
            <Input value={config.default_utm_campaign} onChange={(event) => patchConfig({ default_utm_campaign: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Titulo</Label>
            <Input value={config.headline} onChange={(event) => patchConfig({ headline: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Subtitulo</Label>
            <Input value={config.subtitle} onChange={(event) => patchConfig({ subtitle: event.target.value })} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle>Blocos da bio</CardTitle>
              <div className="flex gap-2">
                <Select value={newBlockType} onValueChange={(value) => setNewBlockType(value as BioBlockType)}>
                  <SelectTrigger className="w-[190px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BLOCK_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={addBlock}>
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {config.blocks.map((block, index) => {
                const expanded = expandedBlockId === block.id;
                return (
                <div key={block.id} className={`rounded-lg border p-4 transition ${expanded ? "border-primary bg-muted/20" : "bg-background"}`}>
                  <div className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${expanded ? "mb-4" : ""}`}>
                    <div className="flex items-center gap-3">
                      <GripVertical className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{blockTypeLabel(block.type)}</Badge>
                          <span className="font-semibold">{block.title || block.id}</span>
                        </div>
                        <p className="line-clamp-1 text-xs text-muted-foreground">
                          {block.subtitle || block.id}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant={expanded ? "default" : "outline"}
                        size="sm"
                        onClick={() => setExpandedBlockId(expanded ? null : block.id)}
                      >
                        {expanded ? "Fechar" : "Editar"}
                      </Button>
                      <Button variant="outline" size="sm" disabled={index === 0} onClick={() => moveBlock(index, -1)}>
                        Subir
                      </Button>
                      <Button variant="outline" size="sm" disabled={index === config.blocks.length - 1} onClick={() => moveBlock(index, 1)}>
                        Descer
                      </Button>
                      <Switch checked={block.enabled} onCheckedChange={(enabled) => patchBlock(index, { enabled })} />
                      <Button variant="ghost" size="icon" onClick={() => removeBlock(index)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {expanded ? (
                  <div className="grid gap-4 border-t pt-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Titulo</Label>
                      <Input value={block.title} onChange={(event) => patchBlock(index, { title: event.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Subtitulo</Label>
                      <Input value={block.subtitle || ""} onChange={(event) => patchBlock(index, { subtitle: event.target.value })} />
                    </div>

                    {block.type === "hero" ? (
                      <>
                        <div className="space-y-2">
                          <Label>Fonte</Label>
                          <Select
                            value={block.source || "manual"}
                            onValueChange={(value) => patchBlock(index, { source: value as BioBlockConfig["source"] })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active_topbar">Campanha ativa do topbar</SelectItem>
                              <SelectItem value="manual">Manual</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>URL fallback</Label>
                          <Input value={block.url || ""} onChange={(event) => patchBlock(index, { url: event.target.value })} />
                        </div>
                      </>
                    ) : null}

                    {block.type === "products" ? (
                      <>
                        <div className="space-y-2">
                          <Label>Algoritmo</Label>
                          <Select
                            value={block.algorithm || "bestsellers"}
                            onValueChange={(value) => patchBlock(index, { algorithm: value as BioProductAlgorithm })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ALGORITHMS.map((algorithm) => (
                                <SelectItem key={algorithm.value} value={algorithm.value}>
                                  {algorithm.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Quantidade</Label>
                          <Input
                            type="number"
                            min={1}
                            max={12}
                            value={block.limit || 6}
                            onChange={(event) => patchBlock(index, { limit: Number(event.target.value) || 6 })}
                          />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>Tags VNDA para algoritmo de tags</Label>
                          <Input
                            value={(block.tags || []).join(", ")}
                            onChange={(event) =>
                              patchBlock(index, {
                                tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean),
                              })
                            }
                          />
                        </div>
                      </>
                    ) : null}

                    {block.type === "categories" ? (
                      <>
                        <div className="space-y-2">
                          <Label>Fonte</Label>
                          <Select
                            value={block.source || "automatic"}
                            onValueChange={(value) => patchBlock(index, { source: value as BioBlockConfig["source"] })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="automatic">Automatica + manuais</SelectItem>
                              <SelectItem value="manual">Somente manuais</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>Categorias manuais</Label>
                          <Textarea
                            rows={5}
                            value={itemsToText(block)}
                            placeholder={"Combos|https://www.bulking.com.br/combos|Promocao atual\nCamisetas|/camisetas|Mais buscadas"}
                            onChange={(event) => patchBlock(index, { items: textToItems(event.target.value) })}
                          />
                        </div>
                      </>
                    ) : null}

                    {["group", "club", "shipping"].includes(block.type) ? (
                      <>
                        <div className="space-y-2">
                          <Label>Texto do botao</Label>
                          <Input value={block.cta_label || ""} onChange={(event) => patchBlock(index, { cta_label: event.target.value })} />
                        </div>
                        <div className="space-y-2">
                          <Label>URL</Label>
                          <Input value={block.url || ""} onChange={(event) => patchBlock(index, { url: event.target.value })} />
                        </div>
                        {block.type === "group" ? (
                          <div className="space-y-2">
                            <Label>Slug do pool</Label>
                            <Input value={block.pool_slug || "vip"} onChange={(event) => patchBlock(index, { pool_slug: event.target.value })} />
                          </div>
                        ) : null}
                      </>
                    ) : null}

                    {block.type === "reviews" ? (
                      <div className="space-y-2">
                        <Label>Quantidade</Label>
                        <Input
                          type="number"
                          min={1}
                          max={8}
                          value={block.limit || 5}
                          onChange={(event) => patchBlock(index, { limit: Number(event.target.value) || 5 })}
                        />
                      </div>
                    ) : null}
                  </div>
                  ) : null}
                </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Preview rapido</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-2xl border bg-[#f5f5f4] p-3">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-black text-sm font-black text-white">
                    {config.brand_name.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-black">{config.headline}</p>
                    <p className="line-clamp-2 text-xs text-neutral-500">{config.subtitle}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {config.blocks.filter((block) => block.enabled).slice(0, 5).map((block) => (
                    <div key={block.id} className="rounded-lg border border-neutral-200 bg-white p-3">
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-neutral-500">
                        {blockTypeLabel(block.type)}
                      </p>
                      <p className="mt-1 font-bold text-neutral-950">{block.title}</p>
                      {block.subtitle ? <p className="text-xs text-neutral-500">{block.subtitle}</p> : null}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Blocos mais clicados</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(metrics?.top_blocks || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Ainda sem cliques registrados.</p>
              ) : (
                metrics?.top_blocks.map((item) => (
                  <div key={item.block_id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="font-semibold">{item.block_id}</p>
                      <p className="text-xs text-muted-foreground">{item.block_type || "bloco"}</p>
                    </div>
                    <Badge>{item.clicks}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
