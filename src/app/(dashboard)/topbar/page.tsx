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
  Stethoscope,
  X,
  CheckCircle2,
  ArrowUp,
  ArrowDown,
  Link2,
  MessageSquareText,
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
import {
  normalizeTopbarSlides,
  serializeTopbarSlides,
  type TopbarSlide,
} from "@/lib/topbar/slides";

// ---------- Tipos ----------

interface TopbarConfig {
  enabled: boolean;
  bg_color: string;
  text_color: string;
  accent_color: string;
  font_size: string;
  height: string;
  title_bold: boolean;
  message_bold: boolean;
  countdown_bg_color: string;
  countdown_text_color: string;
  countdown_font_weight: string;
  countdown_padding: string;
  countdown_border_radius: string;
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
  title: string | null;
  message: string;
  slides?: TopbarSlide[] | null;
  link_url: string | null;
  link_label: string | null;
  countdown_enabled: boolean;
  countdown_target: string | null;
  countdown_label: string;
  countdown_recurrence: "fixed" | "rolling_daily" | "rolling_weekly";
  bg_color: string | null;
  text_color: string | null;
  accent_color: string | null;
  font_size: string | null;
  height: string | null;
  title_bold: boolean | null;
  message_bold: boolean | null;
  countdown_bg_color: string | null;
  countdown_text_color: string | null;
  countdown_font_weight: string | null;
  countdown_padding: string | null;
  countdown_border_radius: string | null;
  show_on_pages: string[] | null;
  context_type: string | null;
  context_brief: string | null;
  auto_regenerate: boolean;
  regenerate_every_hours: number;
  last_regenerated_at: string | null;
  next_regenerate_at: string | null;
}

interface DiagnosticCampaign {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  reasons_blocked: string[];
  matches_now: boolean;
}
interface GlobalCheck {
  ok: boolean;
  label: string;
  detail?: string;
}
interface DiagnosticResult {
  now: string;
  page_type: string;
  global_checks: GlobalCheck[];
  global_ok: boolean;
  campaigns: DiagnosticCampaign[];
  winner_id: string | null;
  winner_name: string | null;
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
  title_bold: true,
  message_bold: false,
  countdown_bg_color: "rgba(255,255,255,.14)",
  countdown_text_color: "",
  countdown_font_weight: "600",
  countdown_padding: "3px 10px",
  countdown_border_radius: "999px",
  sticky: true,
  position: "top",
  show_close_button: true,
  close_persistence_hours: 24,
  show_on_pages: ["all"],
  hide_on_pages: ["cart", "checkout"],
  ai_enabled: false,
  ai_context: "",
  ai_brand_voice: "",
  ai_model: "anthropic/claude-haiku-4.5",
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
    title: "",
    message: "",
    slides: [{ title: "", message: "" }],
    link_url: "",
    link_label: "",
    countdown_enabled: false,
    countdown_target: null,
    countdown_label: "Termina em",
    countdown_recurrence: "fixed",
    bg_color: null,
    text_color: null,
    accent_color: null,
    font_size: null,
    height: null,
    title_bold: null,
    message_bold: null,
    countdown_bg_color: null,
    countdown_text_color: null,
    countdown_font_weight: null,
    countdown_padding: null,
    countdown_border_radius: null,
    show_on_pages: null,
    context_type: "launch",
    context_brief: "",
    auto_regenerate: false,
    regenerate_every_hours: 24,
  };
}

function withEditableSlides(campaign: Partial<Campaign>): Partial<Campaign> {
  const slides = normalizeTopbarSlides(
    campaign.slides,
    campaign.title,
    campaign.message,
    { keepEmpty: true }
  );
  const first = slides[0] || { title: "", message: "" };
  return {
    ...campaign,
    slides,
    title: first.title || "",
    message: first.message || "",
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
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagPage, setDiagPage] = useState("home");

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
    setEditing(withEditableSlides(c));
    const res = await fetch(`/api/topbar/campaigns/${c.id}`, { headers: headers() });
    const data = await res.json();
    if (data.campaign) setEditing(withEditableSlides(data.campaign));
    setVariations(data.variations || []);
    setTab("edit");
  }

  function newCampaign() {
    setEditing(withEditableSlides(emptyCampaign()));
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
      const content = serializeTopbarSlides(editing.slides, editing.title, editing.message);
      const res = await fetch(url, {
        method,
        headers: headers(),
        body: JSON.stringify({
          ...editing,
          title: content.title || "",
          message: content.message,
          slides: content.slides,
        }),
      });
      const data = await res.json();
      if (data.campaign) {
        await loadAll();
        setEditing(withEditableSlides(data.campaign));
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
        ? {
            ...prev,
            message: v.message,
            slides: [{ title: prev.title || "", message: v.message }],
            link_label: v.link_label || prev.link_label,
          }
        : prev
    );
  }

  async function deleteVariation(v: Variation) {
    if (!editing?.id) return;
    if (!confirm("Apagar essa variação?")) return;
    await fetch(
      `/api/topbar/campaigns/${editing.id}/variations/${v.id}`,
      { method: "DELETE", headers: headers() }
    );
    setVariations((prev) => prev.filter((x) => x.id !== v.id));
  }

  async function runDiagnostic() {
    if (!workspace?.id) return;
    setDiagnosing(true);
    try {
      const res = await fetch(
        `/api/topbar/diagnose?page_type=${encodeURIComponent(diagPage)}`,
        { headers: headers() }
      );
      const data = await res.json();
      setDiagnostic(data);
    } finally {
      setDiagnosing(false);
    }
  }

  async function clearLlmVariations() {
    if (!editing?.id) return;
    if (!confirm("Apagar todas as variações geradas por IA? (Variações humanas serão mantidas)")) return;
    await fetch(
      `/api/topbar/campaigns/${editing.id}/variations?source=llm`,
      { method: "DELETE", headers: headers() }
    );
    setVariations((prev) => prev.filter((x) => x.generated_by !== "llm"));
  }

  const editingSlides = useMemo(
    () =>
      editing
        ? normalizeTopbarSlides(editing.slides, editing.title, editing.message, {
            keepEmpty: true,
          })
        : [],
    [editing]
  );

  function updateEditingSlides(nextSlides: TopbarSlide[]) {
    const slides = nextSlides.length ? nextSlides : [{ title: "", message: "" }];
    const first = slides[0] || { title: "", message: "" };
    setEditing((prev) =>
      prev
        ? {
            ...prev,
            slides,
            title: first.title || "",
            message: first.message || "",
          }
        : prev
    );
  }

  function updateEditingSlide(index: number, patch: Partial<TopbarSlide>) {
    const next = editingSlides.map((slide, i) =>
      i === index ? { ...slide, ...patch } : slide
    );
    updateEditingSlides(next);
  }

  function moveEditingSlide(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= editingSlides.length) return;
    const next = [...editingSlides];
    const [slide] = next.splice(index, 1);
    next.splice(target, 0, slide);
    updateEditingSlides(next);
  }

  const previewSlide =
    editingSlides.find((slide) => slide.message.trim().length > 0) ||
    editingSlides[0] ||
    { title: "", message: "" };

  const previewStyle = useMemo<React.CSSProperties>(() => {
    const bg = editing?.bg_color || config.bg_color;
    const fg = editing?.text_color || config.text_color;
    return {
      background: bg,
      color: fg,
      padding: "10px 14px",
      borderRadius: 8,
      fontSize: editing?.font_size || config.font_size,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      minHeight: editing?.height || config.height,
      flexWrap: "wrap",
    };
  }, [editing, config]);

  // Resolução de estilo da campanha (override → global)
  const effectiveTitleBold =
    editing?.title_bold === null || editing?.title_bold === undefined
      ? config.title_bold
      : editing.title_bold;
  const effectiveMessageBold =
    editing?.message_bold === null || editing?.message_bold === undefined
      ? config.message_bold
      : editing.message_bold;
  const effectiveCdBg =
    editing?.countdown_bg_color || config.countdown_bg_color || "rgba(255,255,255,.14)";
  const effectiveCdColor =
    editing?.countdown_text_color ||
    config.countdown_text_color ||
    editing?.text_color ||
    config.text_color;
  const effectiveCdWeight =
    editing?.countdown_font_weight || config.countdown_font_weight || "600";
  const effectiveCdPad = editing?.countdown_padding || config.countdown_padding || "3px 10px";
  const effectiveCdRadius =
    editing?.countdown_border_radius || config.countdown_border_radius || "999px";

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
          <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 p-3 text-xs flex items-start gap-2">
            <Megaphone className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              Esta aba define os <b>defaults visuais</b> (cores, altura, countdown, IA).
              Cada campanha pode <b>sobrescrever</b> qualquer um desses estilos —
              defina overrides em <b>Campanhas → Editar → Estilo</b>.
            </div>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Aparência e comportamento global</CardTitle>
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
                <div className="col-span-2">
                  <Label>Font size</Label>
                  <Input
                    value={config.font_size}
                    onChange={(e) => setConfig({ ...config, font_size: e.target.value })}
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

              {config.show_close_button && (
                <div className="border rounded p-3 space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label className="font-medium">Quanto tempo a topbar fica escondida depois do close (horas)</Label>
                      <p className="text-xs text-muted-foreground">
                        Quando o cliente fecha, esperamos esse tempo antes de mostrar de novo no mesmo navegador.
                        Coloque <b>0</b> pra fazer reaparecer imediatamente (útil pra testar).
                      </p>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      className="w-24"
                      value={config.close_persistence_hours}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          close_persistence_hours: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between border rounded p-3">
                  <div>
                    <Label className="font-medium">Título em bold</Label>
                    <p className="text-xs text-muted-foreground">
                      O texto destacado antes da mensagem.
                    </p>
                  </div>
                  <Switch
                    checked={config.title_bold}
                    onCheckedChange={(v) => setConfig({ ...config, title_bold: v })}
                  />
                </div>
                <div className="flex items-center justify-between border rounded p-3">
                  <div>
                    <Label className="font-medium">Mensagem em bold</Label>
                    <p className="text-xs text-muted-foreground">
                      O texto principal da campanha.
                    </p>
                  </div>
                  <Switch
                    checked={config.message_bold}
                    onCheckedChange={(v) => setConfig({ ...config, message_bold: v })}
                  />
                </div>
              </div>

              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <div>
                  <Label className="font-medium flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Countdown default
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Aplica-se a todas as campanhas com countdown. Cada campanha pode
                    sobrescrever individualmente.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Fundo do badge</Label>
                    <Input
                      value={config.countdown_bg_color}
                      onChange={(e) =>
                        setConfig({ ...config, countdown_bg_color: e.target.value })
                      }
                      placeholder="rgba(255,255,255,.14)"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Aceita hex, rgba, etc. Use rgba para transparência.
                    </p>
                  </div>
                  <div>
                    <Label>Cor do texto (opcional)</Label>
                    <Input
                      value={config.countdown_text_color}
                      onChange={(e) =>
                        setConfig({ ...config, countdown_text_color: e.target.value })
                      }
                      placeholder="herda cor do texto da topbar"
                    />
                  </div>
                  <div>
                    <Label>Font-weight</Label>
                    <Input
                      value={config.countdown_font_weight}
                      onChange={(e) =>
                        setConfig({ ...config, countdown_font_weight: e.target.value })
                      }
                      placeholder="600"
                    />
                  </div>
                  <div>
                    <Label>Padding</Label>
                    <Input
                      value={config.countdown_padding}
                      onChange={(e) =>
                        setConfig({ ...config, countdown_padding: e.target.value })
                      }
                      placeholder="3px 10px"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label>Border-radius</Label>
                    <Input
                      value={config.countdown_border_radius}
                      onChange={(e) =>
                        setConfig({ ...config, countdown_border_radius: e.target.value })
                      }
                      placeholder="999px"
                    />
                  </div>
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
                  <Label>Modelo (OpenRouter)</Label>
                  <Input
                    value={config.ai_model}
                    onChange={(e) => setConfig({ ...config, ai_model: e.target.value })}
                    placeholder="anthropic/claude-haiku-4.5"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Recomendado: <code>anthropic/claude-haiku-4.5</code> (segue prompt e não alucina preço).
                    Evite <code>openrouter/auto</code> — roteia pra modelos fracos.
                  </p>
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

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-blue-500" />
                Diagnóstico — por que não aparece?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label>Simular página</Label>
                  <Select value={diagPage} onValueChange={setDiagPage}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="home">Home</SelectItem>
                      <SelectItem value="product">Produto</SelectItem>
                      <SelectItem value="category">Categoria</SelectItem>
                      <SelectItem value="cart">Carrinho</SelectItem>
                      <SelectItem value="other">Outra</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={runDiagnostic} disabled={diagnosing}>
                  {diagnosing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Stethoscope className="h-4 w-4 mr-2" />
                  )}
                  Rodar diagnóstico
                </Button>
              </div>

              {diagnostic && (
                <div className="space-y-3 text-sm">
                  <div className="text-xs text-muted-foreground">
                    Avaliado em {new Date(diagnostic.now).toLocaleString("pt-BR")}{" "}
                    para a página <b>{diagnostic.page_type}</b>.
                  </div>

                  <div className="space-y-1">
                    {diagnostic.global_checks.map((c, i) => (
                      <div key={i} className="flex items-start gap-2">
                        {c.ok ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                        ) : (
                          <X className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                        )}
                        <div>
                          <span className={c.ok ? "" : "font-medium text-destructive"}>
                            {c.label}
                          </span>
                          {c.detail && (
                            <p className="text-xs text-muted-foreground">{c.detail}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {diagnostic.global_ok && (
                    <div className="border-t pt-3">
                      {diagnostic.winner_id ? (
                        <div className="flex items-center gap-2 text-emerald-700">
                          <CheckCircle2 className="h-4 w-4" />
                          Vencedora agora: <b>{diagnostic.winner_name}</b>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-destructive">
                          <X className="h-4 w-4" />
                          Nenhuma campanha está casando agora.
                        </div>
                      )}
                      <div className="mt-3 space-y-2">
                        {diagnostic.campaigns.map((c) => (
                          <div key={c.id} className="border rounded p-2">
                            <div className="flex items-center gap-2">
                              {c.matches_now ? (
                                <Badge variant="default">Casa agora</Badge>
                              ) : (
                                <Badge variant="secondary">Bloqueada</Badge>
                              )}
                              <span className="font-medium">{c.name}</span>
                              <span className="ml-auto text-xs text-muted-foreground">
                                P{c.priority}
                              </span>
                            </div>
                            {c.reasons_blocked.length > 0 && (
                              <ul className="text-xs text-muted-foreground list-disc ml-5 mt-1">
                                {c.reasons_blocked.map((r, i) => (
                                  <li key={i}>{r}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground border-t pt-2">
                    Se o servidor diz que tudo casa mas a barra ainda não aparece na loja:
                    <ul className="list-disc ml-5 mt-1 space-y-1">
                      <li>Cache CDN: aguarde ~1 min ou force reload na loja (Cmd+Shift+R).</li>
                      <li>
                        Você fechou a barra antes? Ela fica escondida pelo período
                        configurado. Console na loja:{" "}
                        <code>{`Object.keys(localStorage).filter(k=>k.startsWith('_vtx_topbar_dismissed_')).forEach(k=>localStorage.removeItem(k))`}</code>
                      </li>
                    </ul>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {campaigns.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center space-y-3">
                <Megaphone className="h-10 w-10 text-muted-foreground mx-auto opacity-50" />
                <p className="text-sm font-medium">Nenhuma campanha ainda</p>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  Cada campanha é onde você configura <b>título</b>, <b>texto</b>, <b>countdown</b>,
                  agendamento, recorrência e variações de IA. Crie a primeira pra começar.
                </p>
                <Button onClick={newCampaign} className="mt-2">
                  <Plus className="h-4 w-4 mr-2" /> Criar primeira campanha
                </Button>
              </CardContent>
            </Card>
          ) : (
            campaigns.map((c) => {
              const slides = normalizeTopbarSlides(c.slides, c.title, c.message);
              const firstSlide = slides[0] || { title: c.title, message: c.message };

              return (
                <Card
                  key={c.id}
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={() => openCampaign(c)}
                >
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{c.name}</span>
                        {c.enabled ? (
                          <Badge variant="default">Ativa</Badge>
                        ) : (
                          <Badge variant="secondary">Pausada</Badge>
                        )}
                        {slides.length > 1 && (
                          <Badge variant="outline">{slides.length} mensagens</Badge>
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
                      <p className="text-sm mt-1 truncate">
                        {firstSlide.title && <b className="mr-1">{firstSlide.title}</b>}
                        <span className="text-muted-foreground">{firstSlide.message}</span>
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground text-right whitespace-nowrap">
                      Prioridade {c.priority}
                    </div>
                  </CardContent>
                </Card>
              );
            })
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
                <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <Label className="font-medium">Identificação da campanha</Label>
                      <p className="text-xs text-muted-foreground">
                        Nome, prioridade e status. Isso não aparece para o cliente.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-sm">Ativa</Label>
                      <Switch
                        checked={editing.enabled ?? true}
                        onCheckedChange={(v) => setEditing({ ...editing, enabled: v })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Nome interno</Label>
                      <Input
                        value={editing.name || ""}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        placeholder="Ex.: Semana dos namorados"
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
                </div>

                <div className="rounded-lg border p-4 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <Label className="font-medium flex items-center gap-2">
                        <MessageSquareText className="h-4 w-4" />
                        Mensagens do topbar
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Adicione mais de um título/texto para a loja alternar automaticamente com rolagem para cima.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        updateEditingSlides([...editingSlides, { title: "", message: "" }])
                      }
                      disabled={editingSlides.length >= 8}
                    >
                      <Plus className="h-4 w-4 mr-1" /> Adicionar
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {editingSlides.map((slide, index) => (
                      <div key={index} className="rounded-lg border bg-background p-3 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <Badge variant="secondary">Mensagem {index + 1}</Badge>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={index === 0}
                              onClick={() => moveEditingSlide(index, -1)}
                              title="Subir mensagem"
                            >
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={index === editingSlides.length - 1}
                              onClick={() => moveEditingSlide(index, 1)}
                              title="Descer mensagem"
                            >
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              disabled={editingSlides.length === 1}
                              onClick={() =>
                                updateEditingSlides(editingSlides.filter((_, i) => i !== index))
                              }
                              title="Remover mensagem"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
                          <div className="lg:col-span-2">
                            <Label>Título</Label>
                            <Input
                              placeholder='Ex.: "FRETE GRÁTIS"'
                              value={slide.title || ""}
                              onChange={(e) =>
                                updateEditingSlide(index, { title: e.target.value })
                              }
                            />
                          </div>
                          <div className="lg:col-span-3">
                            <Label>Texto</Label>
                            <Textarea
                              rows={2}
                              placeholder="Texto principal que aparece ao lado do título"
                              value={slide.message || ""}
                              onChange={(e) =>
                                updateEditingSlide(index, { message: e.target.value })
                              }
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
                  <div>
                    <Label className="font-medium flex items-center gap-2">
                      <Link2 className="h-4 w-4" />
                      Link e chamada para ação
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Opcional. O mesmo CTA acompanha todas as mensagens desta campanha.
                    </p>
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
                </div>

                <div className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="text-xs text-muted-foreground">Preview</div>
                    {editingSlides.length > 1 && (
                      <Badge variant="outline">slide automático vertical</Badge>
                    )}
                  </div>
                  <div style={previewStyle}>
                    {previewSlide.title && (
                      <span style={{ fontWeight: effectiveTitleBold ? 700 : 400, letterSpacing: ".02em" }}>
                        {previewSlide.title}
                      </span>
                    )}
                    <span style={{ fontWeight: effectiveMessageBold ? 700 : 400 }}>
                      {previewSlide.message || "Sua mensagem aparece aqui"}
                    </span>
                    {editing.countdown_enabled && (
                      <span
                        style={{
                          background: effectiveCdBg,
                          color: effectiveCdColor,
                          borderRadius: effectiveCdRadius,
                          padding: effectiveCdPad,
                          fontWeight: effectiveCdWeight,
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

                    <div className="border-t pt-4 space-y-3">
                      <div>
                        <Label className="font-medium">Estilo do countdown</Label>
                        <p className="text-xs text-muted-foreground">
                          Sobrescrevem o estilo definido nas Configurações globais. Deixe em
                          branco pra herdar.
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <OptionalColorField
                          label="Fundo do badge"
                          value={editing.countdown_bg_color}
                          placeholder={config.countdown_bg_color}
                          onChange={(v) =>
                            setEditing({ ...editing, countdown_bg_color: v || null })
                          }
                        />
                        <OptionalColorField
                          label="Cor do texto"
                          value={editing.countdown_text_color}
                          placeholder={config.countdown_text_color || editing.text_color || config.text_color}
                          onChange={(v) =>
                            setEditing({ ...editing, countdown_text_color: v || null })
                          }
                        />
                        <div>
                          <Label>Font-weight</Label>
                          <Input
                            value={editing.countdown_font_weight || ""}
                            placeholder={config.countdown_font_weight}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                countdown_font_weight: e.target.value || null,
                              })
                            }
                          />
                        </div>
                        <div>
                          <Label>Padding</Label>
                          <Input
                            value={editing.countdown_padding || ""}
                            placeholder={config.countdown_padding}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                countdown_padding: e.target.value || null,
                              })
                            }
                          />
                        </div>
                        <div className="col-span-2">
                          <Label>Border-radius</Label>
                          <Input
                            value={editing.countdown_border_radius || ""}
                            placeholder={config.countdown_border_radius}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                countdown_border_radius: e.target.value || null,
                              })
                            }
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Use <code>999px</code> para pílula, <code>4px</code> pra quadrado suave.
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Estilo da campanha</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Sobrescrevem o estilo global. Deixe em branco para herdar das Configurações.
                </p>

                <div className="grid grid-cols-3 gap-4">
                  <OptionalColorField
                    label="Fundo"
                    value={editing.bg_color}
                    placeholder={config.bg_color}
                    onChange={(v) => setEditing({ ...editing, bg_color: v || null })}
                  />
                  <OptionalColorField
                    label="Texto"
                    value={editing.text_color}
                    placeholder={config.text_color}
                    onChange={(v) => setEditing({ ...editing, text_color: v || null })}
                  />
                  <OptionalColorField
                    label="Destaque (CTA)"
                    value={editing.accent_color}
                    placeholder={config.accent_color}
                    onChange={(v) => setEditing({ ...editing, accent_color: v || null })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Altura</Label>
                    <Input
                      value={editing.height || ""}
                      placeholder={config.height}
                      onChange={(e) =>
                        setEditing({ ...editing, height: e.target.value || null })
                      }
                    />
                  </div>
                  <div>
                    <Label>Font size</Label>
                    <Input
                      value={editing.font_size || ""}
                      placeholder={config.font_size}
                      onChange={(e) =>
                        setEditing({ ...editing, font_size: e.target.value || null })
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <TristateBoldField
                    label="Título em bold"
                    value={editing.title_bold ?? null}
                    globalValue={config.title_bold}
                    onChange={(v) => setEditing({ ...editing, title_bold: v })}
                  />
                  <TristateBoldField
                    label="Mensagem em bold"
                    value={editing.message_bold ?? null}
                    globalValue={config.message_bold}
                    onChange={(v) => setEditing({ ...editing, message_bold: v })}
                  />
                </div>

                <div>
                  <Label>Aparecer em (opcional)</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {PAGE_OPTIONS.map((p) => {
                      const current = editing.show_on_pages ?? [];
                      const active = current.includes(p.value);
                      return (
                        <Badge
                          key={p.value}
                          variant={active ? "default" : "outline"}
                          className="cursor-pointer"
                          onClick={() => {
                            const next = active
                              ? current.filter((x) => x !== p.value)
                              : [...current.filter((x) => x !== "all" || p.value === "all"), p.value];
                            setEditing({
                              ...editing,
                              show_on_pages: next.length ? next : null,
                            });
                          }}
                        >
                          {p.label}
                        </Badge>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Vazio = herda do global ({(config.show_on_pages || []).join(", ") || "all"}).
                  </p>
                </div>
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
                    <div className="flex items-center justify-between">
                      <Label>Variações ({variations.length})</Label>
                      {variations.some((v) => v.generated_by === "llm") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={clearLlmVariations}
                        >
                          <Trash2 className="h-3 w-3 mr-1" /> Limpar variações de IA
                        </Button>
                      )}
                    </div>
                    {variations.map((v) => (
                      <div
                        key={v.id}
                        className={`border rounded p-3 cursor-pointer group ${
                          v.selected ? "border-emerald-500 bg-emerald-50/40" : ""
                        }`}
                        onClick={() => selectVariation(v)}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={v.generated_by === "llm" ? "secondary" : "outline"}>
                            {v.generated_by === "llm" ? "IA" : "Humano"}
                          </Badge>
                          {v.selected && <Badge variant="default">Selecionada</Badge>}
                          <button
                            type="button"
                            aria-label="Apagar variação"
                            className="ml-auto opacity-0 group-hover:opacity-100 text-destructive hover:bg-destructive/10 rounded p-1 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteVariation(v);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
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
            Nenhum script extra. A topbar roda dentro do <code className="bg-muted px-1 rounded">shelves.js</code> que
            já está injetado na loja (mesma API key, mesma tag do GTM). Basta ativar uma campanha aqui.
          </p>
          <p className="text-xs text-muted-foreground">
            <ExternalLink className="h-3 w-3 inline mr-1" />
            Quem ainda não tem o shelves.js: configurar em{" "}
            <Link href="/shelves" className="underline">Prateleiras</Link>.
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

// Color field opcional: vazio = herda do global (mostra cor do placeholder)
function OptionalColorField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string | null | undefined;
  placeholder?: string | null;
  onChange: (v: string) => void;
}) {
  // Para o color picker (que exige hex válido), usa fallback do placeholder ou cinza
  const pickerValue = isHex(value) ? value! : isHex(placeholder) ? placeholder! : "#888888";
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          type="color"
          value={pickerValue}
          onChange={(e) => onChange(e.target.value)}
          className="w-12 p-1 h-9"
        />
        <Input
          value={value ?? ""}
          placeholder={placeholder ? `herda ${placeholder}` : "herda global"}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function isHex(v: string | null | undefined): v is string {
  return typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);
}

// Bold com 3 estados: herda global | true | false
function TristateBoldField({
  label,
  value,
  globalValue,
  onChange,
}: {
  label: string;
  value: boolean | null;
  globalValue: boolean;
  onChange: (v: boolean | null) => void;
}) {
  const current = value === null ? "inherit" : value ? "bold" : "regular";
  return (
    <div className="border rounded p-3">
      <Label className="font-medium">{label}</Label>
      <Select
        value={current}
        onValueChange={(v) =>
          onChange(v === "inherit" ? null : v === "bold")
        }
      >
        <SelectTrigger className="mt-2">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">
            Herdar do global ({globalValue ? "bold" : "regular"})
          </SelectItem>
          <SelectItem value="bold">Bold</SelectItem>
          <SelectItem value="regular">Regular</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
