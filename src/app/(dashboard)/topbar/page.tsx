"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Megaphone,
  Save,
  Loader2,
  Check,
  Plus,
  Trash2,
  Sparkles,
  Clock,
  ExternalLink,
  Key,
} from "lucide-react";
import Link from "next/link";
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

// ---------- Tipos ----------

interface TopbarConfig {
  enabled: boolean;
  bg_color: string;
  text_color: string;
  accent_color: string;
  font_size: string;
  height: string;
  sticky: boolean;
  position: "top" | "bottom";
  show_close_button: boolean;
  close_persistence_hours: number;
  show_on_pages: string[];
  hide_on_pages: string[];
  ai_enabled: boolean;
  ai_context: string;
  ai_brand_voice: string;
  ai_model: string;
  ai_variations_per_run: number;
}

interface Campaign {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  recurrence: "none" | "daily" | "weekly" | "monthly";
  recurrence_days: number[] | null;
  recurrence_window_start: string | null;
  recurrence_window_end: string | null;
  message: string;
  link_url: string | null;
  link_label: string | null;
  countdown_enabled: boolean;
  countdown_target: string | null;
  countdown_label: string;
  countdown_recurrence: "fixed" | "rolling_daily" | "rolling_weekly";
  bg_color: string | null;
  text_color: string | null;
  accent_color: string | null;
  show_on_pages: string[] | null;
  context_type: string | null;
  context_brief: string | null;
  auto_regenerate: boolean;
  regenerate_every_hours: number;
  last_regenerated_at: string | null;
  next_regenerate_at: string | null;
}

interface Variation {
  id: string;
  campaign_id: string;
  message: string;
  link_label: string | null;
  selected: boolean;
  generated_by: "human" | "llm";
  llm_model: string | null;
  created_at: string;
}

const DEFAULT_CONFIG: TopbarConfig = {
  enabled: false,
  bg_color: "#0f172a",
  text_color: "#ffffff",
  accent_color: "#22c55e",
  font_size: "14px",
  height: "40px",
  sticky: true,
  position: "top",
  show_close_button: true,
  close_persistence_hours: 24,
  show_on_pages: ["all"],
  hide_on_pages: ["cart", "checkout"],
  ai_enabled: false,
  ai_context: "",
  ai_brand_voice: "",
  ai_model: "openrouter/auto",
  ai_variations_per_run: 3,
};

const PAGE_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "home", label: "Home" },
  { value: "product", label: "Produto" },
  { value: "category", label: "Categoria" },
];

const WEEKDAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

function emptyCampaign(): Partial<Campaign> {
  return {
    name: "",
    enabled: true,
    priority: 0,
    starts_at: null,
    ends_at: null,
    recurrence: "none",
    recurrence_days: null,
    recurrence_window_start: null,
    recurrence_window_end: null,
    message: "",
    link_url: "",
    link_label: "",
    countdown_enabled: false,
    countdown_target: null,
    countdown_label: "Termina em",
    countdown_recurrence: "fixed",
    bg_color: null,
    text_color: null,
    accent_color: null,
    show_on_pages: null,
    context_type: "launch",
    context_brief: "",
    auto_regenerate: false,
    regenerate_every_hours: 24,
  };
}

// ---------- Component ----------

export default function TopbarPage() {
  const { workspace } = useWorkspace();
  const [tab, setTab] = useState("settings");

  // Settings
  const [config, setConfig] = useState<TopbarConfig>(DEFAULT_CONFIG);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savedConfig, setSavedConfig] = useState(false);

  // Campaigns
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [hasApiKey, setHasApiKey] = useState(false);

  // Editing
  const [editing, setEditing] = useState<Partial<Campaign> | null>(null);
  const [variations, setVariations] = useState<Variation[]>([]);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [generating, setGenerating] = useState(false);

  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "x-workspace-id": workspace?.id || "",
    }),
    [workspace?.id]
  );

  const loadAll = useCallback(async () => {
    if (!workspace?.id) return;
    try {
      const [c, list, keys] = await Promise.all([
        fetch("/api/topbar/config", { headers: headers() }).then((r) => r.json()),
        fetch("/api/topbar/campaigns", { headers: headers() }).then((r) => r.json()),
        fetch("/api/shelves/api-keys", { headers: headers() }).then((r) => r.json()),
      ]);
      if (c?.config) setConfig({ ...DEFAULT_CONFIG, ...c.config });
      setCampaigns(list?.campaigns || []);
      setHasApiKey((keys?.keys || []).length > 0);
    } catch (e) {
      console.error("topbar load:", e);
    }
  }, [workspace?.id, headers]);

  useEffect(() => {
    if (workspace?.id) loadAll();
  }, [workspace?.id, loadAll]);

  async function saveConfig() {
    if (!workspace?.id) return;
    setSavingConfig(true);
    setSavedConfig(false);
    try {
      const res = await fetch("/api/topbar/config", {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (data.config) {
        setConfig({ ...DEFAULT_CONFIG, ...data.config });
        setSavedConfig(true);
        setTimeout(() => setSavedConfig(false), 2500);
      }
    } finally {
      setSavingConfig(false);
    }
  }

  async function openCampaign(c: Campaign) {
    setEditing(c);
    const res = await fetch(`/api/topbar/campaigns/${c.id}`, { headers: headers() });
    const data = await res.json();
    setVariations(data.variations || []);
    setTab("edit");
  }

  function newCampaign() {
    setEditing(emptyCampaign());
    setVariations([]);
    setTab("edit");
  }

  async function saveCampaign() {
    if (!editing) return;
    setSavingCampaign(true);
    try {
      const isNew = !("id" in editing) || !editing.id;
      const url = isNew
        ? "/api/topbar/campaigns"
        : `/api/topbar/campaigns/${editing.id}`;
      const method = isNew ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: headers(),
        body: JSON.stringify(editing),
      });
      const data = await res.json();
      if (data.campaign) {
        await loadAll();
        setEditing(data.campaign);
      }
    } finally {
      setSavingCampaign(false);
    }
  }

  async function deleteCampaign(id: string) {
    if (!confirm("Apagar essa campanha?")) return;
    await fetch(`/api/topbar/campaigns/${id}`, {
      method: "DELETE",
      headers: headers(),
    });
    await loadAll();
    setEditing(null);
    setTab("campaigns");
  }

  async function generateVariations() {
    if (!editing?.id) {
      alert("Salve a campanha primeiro.");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch(`/api/topbar/campaigns/${editing.id}/generate`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ count: config.ai_variations_per_run }),
      });
      const data = await res.json();
      if (data.variations) {
        setVariations((prev) => [...data.variations, ...prev]);
      } else if (data.error) {
        alert("Erro ao gerar: " + data.error);
      }
    } catch (e) {
      alert("Erro: " + (e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function selectVariation(v: Variation) {
    if (!editing?.id) return;
    await fetch(
      `/api/topbar/campaigns/${editing.id}/variations/${v.id}/select`,
      { method: "POST", headers: headers() }
    );
    setVariations((prev) =>
      prev.map((x) => ({ ...x, selected: x.id === v.id }))
    );
    setEditing((prev) =>
      prev
        ? { ...prev, message: v.message, link_label: v.link_label || prev.link_label }
        : prev
    );
  }

  const previewStyle = useMemo<React.CSSProperties>(() => {
    const bg = editing?.bg_color || config.bg_color;
    const fg = editing?.text_color || config.text_color;
    return {
      background: bg,
      color: fg,
      padding: "10px 14px",
      borderRadius: 8,
      fontSize: config.font_size,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      minHeight: config.height,
      flexWrap: "wrap",
    };
  }, [editing, config]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Megaphone className="h-7 w-7 text-emerald-500" />
          <div>
            <h1 className="text-2xl font-bold">Topbar</h1>
            <p className="text-sm text-muted-foreground">
              Régua flutuante de ofertas com countdown, agendamento e variações geradas por IA.
            </p>
          </div>
        </div>
        {!hasApiKey && (
          <Link href="/shelves">
            <Button variant="outline" size="sm">
              <Key className="h-4 w-4 mr-2" />
              Configurar API key
            </Button>
          </Link>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="settings">Configurações</TabsTrigger>
          <TabsTrigger value="campaigns">Campanhas ({campaigns.length})</TabsTrigger>
          {editing && <TabsTrigger value="edit">Editar</TabsTrigger>}
        </TabsList>

        {/* ---------- Settings tab ---------- */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Estado global</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium">Topbar ativada</Label>
                  <p className="text-xs text-muted-foreground">
                    Quando desligada, nenhuma campanha aparece na loja.
                  </p>
                </div>
                <Switch
                  checked={config.enabled}
                  onCheckedChange={(v) => setConfig({ ...config, enabled: v })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Posição</Label>
                  <Select
                    value={config.position}
                    onValueChange={(v) => setConfig({ ...config, position: v as "top" | "bottom" })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="top">Topo</SelectItem>
                      <SelectItem value="bottom">Rodapé</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Altura</Label>
                  <Input
                    value={config.height}
                    onChange={(e) => setConfig({ ...config, height: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Font size</Label>
                  <Input
                    value={config.font_size}
                    onChange={(e) => setConfig({ ...config, font_size: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Persistência do close (h)</Label>
                  <Input
                    type="number"
                    value={config.close_persistence_hours}
                    onChange={(e) =>
                      setConfig({ ...config, close_persistence_hours: Number(e.target.value) })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <ColorField
                  label="Fundo"
                  value={config.bg_color}
                  onChange={(v) => setConfig({ ...config, bg_color: v })}
                />
                <ColorField
                  label="Texto"
                  value={config.text_color}
                  onChange={(v) => setConfig({ ...config, text_color: v })}
                />
                <ColorField
                  label="Destaque (CTA)"
                  value={config.accent_color}
                  onChange={(v) => setConfig({ ...config, accent_color: v })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between border rounded p-3">
                  <div>
                    <Label className="font-medium">Flutuar ao rolar (sticky)</Label>
                    <p className="text-xs text-muted-foreground">
                      Fixa a barra no topo durante o scroll.
                    </p>
                  </div>
                  <Switch
                    checked={config.sticky}
                    onCheckedChange={(v) => setConfig({ ...config, sticky: v })}
                  />
                </div>
                <div className="flex items-center justify-between border rounded p-3">
                  <div>
                    <Label className="font-medium">Botão fechar</Label>
                    <p className="text-xs text-muted-foreground">
                      Permite o cliente esconder a barra.
                    </p>
                  </div>
                  <Switch
                    checked={config.show_close_button}
                    onCheckedChange={(v) => setConfig({ ...config, show_close_button: v })}
                  />
                </div>
              </div>

              <div>
                <Label>Aparecer em</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {PAGE_OPTIONS.map((p) => {
                    const active = config.show_on_pages.includes(p.value);
                    return (
                      <Badge
                        key={p.value}
                        variant={active ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => {
                          const next = active
                            ? config.show_on_pages.filter((x) => x !== p.value)
                            : [...config.show_on_pages.filter((x) => x !== "all" || p.value === "all"), p.value];
                          setConfig({ ...config, show_on_pages: next.length ? next : ["all"] });
                        }}
                      >
                        {p.label}
                      </Badge>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Carrinho e checkout estão <b>sempre</b> escondidos (garantido pelo
                  servidor e pelo JS).
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-500" />
                IA (OpenRouter)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium">Habilitar geração de variações</Label>
                  <p className="text-xs text-muted-foreground">
                    Necessário pra usar auto-regeneração em campanhas.
                  </p>
                </div>
                <Switch
                  checked={config.ai_enabled}
                  onCheckedChange={(v) => setConfig({ ...config, ai_enabled: v })}
                />
              </div>

              <div>
                <Label>Contexto do negócio</Label>
                <Textarea
                  rows={3}
                  placeholder="Ex.: Bulking é uma marca de moda masculina premium focada em peças básicas elevadas..."
                  value={config.ai_context}
                  onChange={(e) => setConfig({ ...config, ai_context: e.target.value })}
                />
              </div>

              <div>
                <Label>Tom de voz</Label>
                <Textarea
                  rows={2}
                  placeholder="Ex.: direto, confiante, sem clichês, sem emojis, fala de você pra você."
                  value={config.ai_brand_voice}
                  onChange={(e) => setConfig({ ...config, ai_brand_voice: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Modelo</Label>
                  <Input
                    value={config.ai_model}
                    onChange={(e) => setConfig({ ...config, ai_model: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Variações por geração</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={config.ai_variations_per_run}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        ai_variations_per_run: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-3">
            {savedConfig && (
              <span className="flex items-center text-sm text-emerald-600">
                <Check className="h-4 w-4 mr-1" /> Salvo
              </span>
            )}
            <Button onClick={saveConfig} disabled={savingConfig}>
              {savingConfig ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Salvar configurações
            </Button>
          </div>
        </TabsContent>

        {/* ---------- Campaigns tab ---------- */}
        <TabsContent value="campaigns" className="space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              Campanhas ordenadas por prioridade. A primeira ativa que casa com o
              agendamento atual é mostrada na loja.
            </p>
            <Button onClick={newCampaign}>
              <Plus className="h-4 w-4 mr-2" /> Nova campanha
            </Button>
          </div>

          {campaigns.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Nenhuma campanha ainda. Crie a primeira pra começar.
              </CardContent>
            </Card>
          ) : (
            campaigns.map((c) => (
              <Card
                key={c.id}
                className="cursor-pointer hover:bg-muted/30"
                onClick={() => openCampaign(c)}
              >
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{c.name}</span>
                      {c.enabled ? (
                        <Badge variant="default">Ativa</Badge>
                      ) : (
                        <Badge variant="secondary">Pausada</Badge>
                      )}
                      {c.countdown_enabled && (
                        <Badge variant="outline">
                          <Clock className="h-3 w-3 mr-1" /> Countdown
                        </Badge>
                      )}
                      {c.auto_regenerate && (
                        <Badge variant="outline">
                          <Sparkles className="h-3 w-3 mr-1" /> Auto-IA
                        </Badge>
                      )}
                      {c.recurrence !== "none" && (
                        <Badge variant="outline">{c.recurrence}</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 truncate">
                      {c.message}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground text-right whitespace-nowrap">
                    Prioridade {c.priority}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* ---------- Edit tab ---------- */}
        {editing && (
          <TabsContent value="edit" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  {editing.id ? "Editar campanha" : "Nova campanha"}
                </CardTitle>
                {editing.id && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteCampaign(editing.id!)}
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Apagar
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Nome interno</Label>
                    <Input
                      value={editing.name || ""}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Prioridade</Label>
                    <Input
                      type="number"
                      value={editing.priority ?? 0}
                      onChange={(e) =>
                        setEditing({ ...editing, priority: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>

                <div>
                  <Label>Mensagem</Label>
                  <Textarea
                    rows={2}
                    value={editing.message || ""}
                    onChange={(e) => setEditing({ ...editing, message: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Link (URL)</Label>
                    <Input
                      value={editing.link_url || ""}
                      onChange={(e) => setEditing({ ...editing, link_url: e.target.value })}
                      placeholder="https://..."
                    />
                  </div>
                  <div>
                    <Label>CTA label</Label>
                    <Input
                      value={editing.link_label || ""}
                      onChange={(e) => setEditing({ ...editing, link_label: e.target.value })}
                      placeholder="Aproveitar"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <Label>Ativa</Label>
                  <Switch
                    checked={editing.enabled ?? true}
                    onCheckedChange={(v) => setEditing({ ...editing, enabled: v })}
                  />
                </div>

                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground mb-2">Preview</div>
                  <div style={previewStyle}>
                    <span>{editing.message || "Sua mensagem aparece aqui"}</span>
                    {editing.countdown_enabled && (
                      <span
                        style={{
                          background: "rgba(255,255,255,.15)",
                          borderRadius: 999,
                          padding: "3px 10px",
                          fontWeight: 600,
                        }}
                      >
                        {editing.countdown_label || "Termina em"} 02:14:33
                      </span>
                    )}
                    {editing.link_url && editing.link_label && (
                      <span
                        style={{
                          background: editing.accent_color || config.accent_color,
                          color: "#fff",
                          padding: "4px 12px",
                          borderRadius: 999,
                          fontWeight: 600,
                          fontSize: 13,
                        }}
                      >
                        {editing.link_label}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Agendamento
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Início</Label>
                    <Input
                      type="datetime-local"
                      value={editing.starts_at ? toLocalInput(editing.starts_at) : ""}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          starts_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Fim</Label>
                    <Input
                      type="datetime-local"
                      value={editing.ends_at ? toLocalInput(editing.ends_at) : ""}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          ends_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                        })
                      }
                    />
                  </div>
                </div>

                <div>
                  <Label>Recorrência</Label>
                  <Select
                    value={editing.recurrence || "none"}
                    onValueChange={(v) =>
                      setEditing({ ...editing, recurrence: v as Campaign["recurrence"] })
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem recorrência</SelectItem>
                      <SelectItem value="daily">Diária</SelectItem>
                      <SelectItem value="weekly">Semanal</SelectItem>
                      <SelectItem value="monthly">Mensal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {editing.recurrence === "weekly" && (
                  <div>
                    <Label>Dias da semana</Label>
                    <div className="flex gap-2 mt-2">
                      {WEEKDAYS.map((d) => {
                        const active = (editing.recurrence_days || []).includes(d.value);
                        return (
                          <Badge
                            key={d.value}
                            variant={active ? "default" : "outline"}
                            className="cursor-pointer"
                            onClick={() => {
                              const cur = editing.recurrence_days || [];
                              setEditing({
                                ...editing,
                                recurrence_days: active
                                  ? cur.filter((x) => x !== d.value)
                                  : [...cur, d.value],
                              });
                            }}
                          >
                            {d.label}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                )}

                {editing.recurrence === "monthly" && (
                  <div>
                    <Label>Dia(s) do mês (separados por vírgula)</Label>
                    <Input
                      value={(editing.recurrence_days || []).join(",")}
                      onChange={(e) => {
                        const days = e.target.value
                          .split(",")
                          .map((x) => parseInt(x.trim(), 10))
                          .filter((x) => Number.isFinite(x) && x >= 1 && x <= 31);
                        setEditing({ ...editing, recurrence_days: days });
                      }}
                      placeholder="1, 15, 28"
                    />
                  </div>
                )}

                {editing.recurrence !== "none" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Janela diária (início)</Label>
                      <Input
                        type="time"
                        value={editing.recurrence_window_start || ""}
                        onChange={(e) =>
                          setEditing({ ...editing, recurrence_window_start: e.target.value || null })
                        }
                      />
                    </div>
                    <div>
                      <Label>Janela diária (fim)</Label>
                      <Input
                        type="time"
                        value={editing.recurrence_window_end || ""}
                        onChange={(e) =>
                          setEditing({ ...editing, recurrence_window_end: e.target.value || null })
                        }
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Countdown
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>Mostrar countdown</Label>
                  <Switch
                    checked={editing.countdown_enabled ?? false}
                    onCheckedChange={(v) => setEditing({ ...editing, countdown_enabled: v })}
                  />
                </div>
                {editing.countdown_enabled && (
                  <>
                    <div>
                      <Label>Tipo</Label>
                      <Select
                        value={editing.countdown_recurrence || "fixed"}
                        onValueChange={(v) =>
                          setEditing({
                            ...editing,
                            countdown_recurrence: v as Campaign["countdown_recurrence"],
                          })
                        }
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fixed">Data fixa</SelectItem>
                          <SelectItem value="rolling_daily">Reinicia diariamente</SelectItem>
                          <SelectItem value="rolling_weekly">Reinicia semanalmente</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {editing.countdown_recurrence === "fixed" && (
                      <div>
                        <Label>Data alvo</Label>
                        <Input
                          type="datetime-local"
                          value={
                            editing.countdown_target ? toLocalInput(editing.countdown_target) : ""
                          }
                          onChange={(e) =>
                            setEditing({
                              ...editing,
                              countdown_target: e.target.value
                                ? new Date(e.target.value).toISOString()
                                : null,
                            })
                          }
                        />
                      </div>
                    )}
                    <div>
                      <Label>Label antes do tempo</Label>
                      <Input
                        value={editing.countdown_label || ""}
                        onChange={(e) =>
                          setEditing({ ...editing, countdown_label: e.target.value })
                        }
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-violet-500" />
                  Contexto e IA
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Tipo de campanha</Label>
                  <Select
                    value={editing.context_type || "launch"}
                    onValueChange={(v) => setEditing({ ...editing, context_type: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="launch">Lançamento</SelectItem>
                      <SelectItem value="sale">Promoção</SelectItem>
                      <SelectItem value="restock">Restock</SelectItem>
                      <SelectItem value="seasonal">Sazonal</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Brief da campanha</Label>
                  <Textarea
                    rows={3}
                    placeholder="Ex.: Lançamento da coleção Gladiator Preta. Foco em moletons premium..."
                    value={editing.context_brief || ""}
                    onChange={(e) =>
                      setEditing({ ...editing, context_brief: e.target.value })
                    }
                  />
                </div>

                <div className="flex items-center justify-between border rounded p-3">
                  <div>
                    <Label className="font-medium">Auto-regenerar</Label>
                    <p className="text-xs text-muted-foreground">
                      A IA gera novas variações periodicamente e seleciona uma.
                    </p>
                  </div>
                  <Switch
                    checked={editing.auto_regenerate ?? false}
                    onCheckedChange={(v) => setEditing({ ...editing, auto_regenerate: v })}
                  />
                </div>
                {editing.auto_regenerate && (
                  <div>
                    <Label>A cada (horas)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={editing.regenerate_every_hours ?? 24}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          regenerate_every_hours: Number(e.target.value),
                        })
                      }
                    />
                    {editing.next_regenerate_at && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Próxima geração: {new Date(editing.next_regenerate_at).toLocaleString("pt-BR")}
                      </p>
                    )}
                  </div>
                )}

                <Button
                  variant="secondary"
                  onClick={generateVariations}
                  disabled={generating || !editing.id}
                  title={!editing.id ? "Salve a campanha primeiro" : ""}
                >
                  {generating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Gerar variações agora
                </Button>

                {variations.length > 0 && (
                  <div className="space-y-2">
                    <Label>Variações ({variations.length})</Label>
                    {variations.map((v) => (
                      <div
                        key={v.id}
                        className={`border rounded p-3 cursor-pointer ${
                          v.selected ? "border-emerald-500 bg-emerald-50/40" : ""
                        }`}
                        onClick={() => selectVariation(v)}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={v.generated_by === "llm" ? "secondary" : "outline"}>
                            {v.generated_by === "llm" ? "IA" : "Humano"}
                          </Badge>
                          {v.selected && <Badge variant="default">Selecionada</Badge>}
                        </div>
                        <p className="text-sm">{v.message}</p>
                        {v.link_label && (
                          <p className="text-xs text-muted-foreground">CTA: {v.link_label}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setEditing(null); setTab("campaigns"); }}>
                Voltar
              </Button>
              <Button onClick={saveCampaign} disabled={savingCampaign}>
                {savingCampaign ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Salvar campanha
              </Button>
            </div>
          </TabsContent>
        )}
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Instalação na loja</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Adicione o script junto com a tag do GTM (ou reaproveite os globals do shelves):
          </p>
          <pre className="bg-muted rounded p-3 text-xs overflow-auto">{`<script>
  window._topbarKey = "SUA_API_KEY";
  window._topbarBase = "https://dash.bulking.com.br";
</script>
<script src="https://dash.bulking.com.br/topbar.js" defer></script>`}</pre>
          <p className="text-xs text-muted-foreground">
            <ExternalLink className="h-3 w-3 inline mr-1" />
            A API key é a mesma usada pelos shelves.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Helpers ----------

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-12 p-1 h-9"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
