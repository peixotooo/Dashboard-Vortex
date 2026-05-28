"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Gift,
  Save,
  Loader2,
  Check,
  RefreshCw,
  MessageCircle,
  CheckCircle2,
  Clock,
  XCircle,
  Sparkles,
  AlertCircle,
  TrendingUp,
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
import {
  GIFT_REQUEST_VARS,
  SAMPLE_GIFT_VARS,
  encodeMappingValue,
  parseMappingValue,
  previewWhatsAppBody,
} from "@/lib/gift-request/variables";
import {
  DEFAULT_VARIABLE_MAPPING,
  NEUTRAL_VARIABLE_MAPPING,
} from "@/lib/gift-request/recommended";

interface GiftRequestConfig {
  enabled: boolean;
  wa_template_id: string | null;
  wa_variable_mapping: Record<string, string>;
  button_label: string;
  button_bg_color: string;
  button_text_color: string;
  button_border_radius: string;
  button_icon: string;
  modal_title: string;
  modal_subtitle: string;
  modal_name_label: string;
  modal_phone_label: string;
  modal_message_label: string;
  modal_cta_label: string;
  modal_success_title: string;
  modal_success_message: string;
  collect_requester_phone: boolean;
  pdp_anchor_selector: string | null;
  hide_on_pages: string[];
}

interface WaTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: Array<{ type: string; text?: string }>;
}

interface GiftRequestRow {
  id: string;
  requester_name: string;
  requester_phone: string | null;
  recipient_phone: string;
  product_id: string;
  product_name: string | null;
  product_url: string | null;
  product_image_url: string | null;
  product_price: number | null;
  personal_message: string | null;
  status: string;
  error_message: string | null;
  page_url: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  converted_order_id: string | null;
  converted_at: string | null;
  wa_status: string | null;
  wa_error: string | null;
}

interface Stats {
  total: number;
  by_status: Record<string, number>;
  read: number;
  read_rate: number;
  converted: number;
  conversion_rate: number;
  top_products: Array<{ product_id: string; count: number }>;
}

const DEFAULT_CONFIG: GiftRequestConfig = {
  enabled: false,
  wa_template_id: null,
  wa_variable_mapping: {},
  button_label: "Pedir de presente",
  button_bg_color: "#000000",
  button_text_color: "#ffffff",
  button_border_radius: "4px",
  button_icon: "gift",
  modal_title: "Pedir de presente",
  modal_subtitle: "Avise alguém especial que você quer ganhar este produto",
  modal_name_label: "Seu nome",
  modal_phone_label: "WhatsApp da pessoa",
  modal_message_label: "Mensagem (opcional)",
  modal_cta_label: "Enviar pedido",
  modal_success_title: "Pedido enviado!",
  modal_success_message:
    "Aguarde — assim que a pessoa responder, você fica sabendo.",
  collect_requester_phone: false,
  pdp_anchor_selector: null,
  hide_on_pages: ["cart", "checkout", "home", "category"],
};

const STATUS_META: Record<
  string,
  { label: string; color: string; Icon: typeof Clock }
> = {
  queued: { label: "Na fila", color: "bg-slate-100 text-slate-700", Icon: Clock },
  sent: { label: "Enviado", color: "bg-blue-100 text-blue-700", Icon: MessageCircle },
  delivered: {
    label: "Entregue",
    color: "bg-emerald-100 text-emerald-700",
    Icon: CheckCircle2,
  },
  read: {
    label: "Lido",
    color: "bg-purple-100 text-purple-700",
    Icon: CheckCircle2,
  },
  failed: { label: "Falhou", color: "bg-red-100 text-red-700", Icon: XCircle },
  converted: {
    label: "Convertido",
    color: "bg-amber-100 text-amber-800",
    Icon: TrendingUp,
  },
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function fmtPercent(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

export default function GiftRequestPage() {
  const { workspace } = useWorkspace();
  const [tab, setTab] = useState("settings");

  const [config, setConfig] = useState<GiftRequestConfig>(DEFAULT_CONFIG);
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [requests, setRequests] = useState<GiftRequestRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "x-workspace-id": workspace?.id || "",
    }),
    [workspace?.id]
  );

  const loadAll = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    setError(null);
    try {
      const [c, t, r, s] = await Promise.all([
        fetch("/api/gift-request/config", { headers: headers() }).then((r) =>
          r.json()
        ),
        fetch("/api/crm/whatsapp/templates", { headers: headers() }).then((r) =>
          r.json()
        ),
        fetch(
          "/api/gift-request/requests" +
            (statusFilter ? `?status=${statusFilter}` : ""),
          { headers: headers() }
        ).then((r) => r.json()),
        fetch("/api/gift-request/stats", { headers: headers() }).then((r) =>
          r.json()
        ),
      ]);
      if (c?.config) setConfig({ ...DEFAULT_CONFIG, ...c.config });
      setTemplates(t?.templates || []);
      setRequests(r?.requests || []);
      setStats(s || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [workspace?.id, headers, statusFilter]);

  useEffect(() => {
    if (workspace?.id) loadAll();
  }, [workspace?.id, loadAll]);

  const approvedTemplates = useMemo(
    () => templates.filter((t) => t.status === "APPROVED"),
    [templates]
  );

  // Pode estar em PENDING — por isso busca em `templates` (todos), não só nos aprovados.
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === config.wa_template_id) || null,
    [templates, config.wa_template_id]
  );

  const templateBody = useMemo(() => {
    if (!selectedTemplate) return "";
    const body = selectedTemplate.components.find((c) => c.type === "BODY");
    return body?.text || "";
  }, [selectedTemplate]);

  const templateSlotCount = useMemo(() => {
    const matches = templateBody.match(/\{\{\s*\d+\s*\}\}/g) || [];
    const positions = new Set(
      matches.map((m) => m.replace(/[^\d]/g, "")).filter(Boolean)
    );
    return positions.size;
  }, [templateBody]);

  const previewBody = useMemo(
    () =>
      previewWhatsAppBody(
        templateBody,
        config.wa_variable_mapping,
        SAMPLE_GIFT_VARS
      ),
    [templateBody, config.wa_variable_mapping]
  );

  async function saveConfig() {
    if (!workspace?.id) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/gift-request/config", {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao salvar");
      setConfig({ ...DEFAULT_CONFIG, ...data.config });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  function setMappingSlot(position: string, raw: string) {
    setConfig((prev) => ({
      ...prev,
      wa_variable_mapping: { ...prev.wa_variable_mapping, [position]: raw },
    }));
  }

  function applyRecommendedMapping(neutral = false) {
    setConfig((prev) => ({
      ...prev,
      wa_variable_mapping: neutral
        ? { ...NEUTRAL_VARIABLE_MAPPING }
        : { ...DEFAULT_VARIABLE_MAPPING },
    }));
  }

  async function recheckTemplate() {
    if (!workspace?.id || !config.wa_template_id) return;
    setRechecking(true);
    setError(null);
    try {
      const res = await fetch("/api/gift-request/recheck-template", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ template_id: config.wa_template_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao consultar Meta");
      await loadAll();
      const status = data.template?.status;
      if (status === "APPROVED") {
        alert("Aprovado pela Meta — pronto pra ativar.");
      } else if (status === "REJECTED") {
        alert(
          "A Meta rejeitou esse template. Veja em /crm/whatsapp pra detalhes ou crie um novo."
        );
      } else {
        alert(`Status atual na Meta: ${status || "desconhecido"}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao consultar Meta");
    } finally {
      setRechecking(false);
    }
  }

  async function createUtilityTemplate() {
    if (!workspace?.id) return;
    if (
      !confirm(
        "Vamos criar um template UTILITY na Meta com o formato genérico ({{1}} {{2}}) e linkar aqui automaticamente. Aprovação costuma sair em minutos. Confirma?"
      )
    )
      return;
    setCreatingTemplate(true);
    setError(null);
    try {
      const res = await fetch("/api/gift-request/create-utility-template", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ apply_to_config: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao criar template");
      await loadAll();
      const tplName = data.template?.name || "(sem nome)";
      const tplStatus = data.template?.status || "PENDING";
      alert(
        `Template criado e linkado:\n\n• Nome: ${tplName}\n• Status: ${tplStatus}\n\n${
          tplStatus === "APPROVED"
            ? "Aprovado! Já pode ativar o switch acima."
            : "A Meta costuma aprovar em alguns minutos. Use o botão 'Atualizar status' pra checar."
        }`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao criar template");
    } finally {
      setCreatingTemplate(false);
    }
  }

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Gift className="w-6 h-6" /> Pedir de presente
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Botão na PDP que envia WhatsApp pra pessoa que vai presentear.
          </p>
        </div>
        <Badge variant={config.enabled ? "default" : "secondary"}>
          {config.enabled ? "Ativo" : "Desativado"}
        </Badge>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-3 flex items-center gap-2 text-sm text-red-800">
            <AlertCircle className="w-4 h-4" />
            {error}
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="settings">Configuração</TabsTrigger>
          <TabsTrigger value="requests">
            Solicitações
            {requests.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {requests.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* ============================== SETTINGS ============================== */}
        <TabsContent value="settings" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Geral</span>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={config.enabled}
                    onCheckedChange={(v) => setConfig({ ...config, enabled: v })}
                  />
                  <Label className="text-sm">
                    {config.enabled ? "Ativo" : "Desativado"}
                  </Label>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs">Seletor CSS opcional (PDP)</Label>
                <Input
                  placeholder="Padrão: próximo ao botão de comprar"
                  value={config.pdp_anchor_selector || ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      pdp_anchor_selector: e.target.value || null,
                    })
                  }
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Se vazio, injeta após o botão de comprar (.buy-button etc.).
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Template WhatsApp</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <Sparkles className="w-4 h-4 mt-0.5" />
                  <div>
                    <div className="font-medium">
                      Criar template UTILITY automaticamente
                    </div>
                    <p className="text-xs text-emerald-800/80 mt-0.5">
                      Envia o template "Olá {"{{1}}"}, tudo bem? {"{{2}}"}..." pra
                      aprovação na Meta e já linka aqui com o mapping
                      recomendado. Mesmo formato usado no Cart Recovery —
                      custo ~10x menor que MARKETING.
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={createUtilityTemplate}
                  disabled={creatingTemplate}
                  className="shrink-0"
                >
                  {creatingTemplate ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-1" />
                  )}
                  Criar agora
                </Button>
              </div>

              {selectedTemplate && selectedTemplate.status !== "APPROVED" && (
                <div
                  className={`rounded border p-3 text-sm flex items-start justify-between gap-3 ${
                    selectedTemplate.status === "REJECTED"
                      ? "border-red-200 bg-red-50 text-red-900"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {selectedTemplate.status === "REJECTED" ? (
                      <XCircle className="w-4 h-4 mt-0.5" />
                    ) : (
                      <Clock className="w-4 h-4 mt-0.5" />
                    )}
                    <div>
                      <div className="font-medium">
                        Template <code className="font-mono">{selectedTemplate.name}</code> ·{" "}
                        <span className="uppercase">{selectedTemplate.status}</span>
                      </div>
                      <p className="text-xs opacity-80 mt-0.5">
                        {selectedTemplate.status === "PENDING" &&
                          "Aguardando aprovação da Meta. Costuma sair em alguns minutos. Clique pra consultar o status atual."}
                        {selectedTemplate.status === "REJECTED" &&
                          "A Meta rejeitou o template. Crie um novo (botão acima) ou ajuste manualmente em /crm/whatsapp."}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={recheckTemplate}
                    disabled={rechecking}
                    className="shrink-0 bg-white"
                  >
                    {rechecking ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-1" />
                    )}
                    Atualizar status
                  </Button>
                </div>
              )}

              {selectedTemplate && selectedTemplate.status === "APPROVED" && (
                <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <div>
                      Template <code className="font-mono">{selectedTemplate.name}</code>{" "}
                      aprovado pela Meta.
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={recheckTemplate}
                    disabled={rechecking}
                    className="shrink-0"
                  >
                    {rechecking ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              )}

              {templates.length === 0 && !selectedTemplate ? (
                <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5" />
                  <div>
                    Nenhum template encontrado ainda. Use o botão acima pra
                    criar um automaticamente, ou{" "}
                    <a
                      href="/crm/whatsapp"
                      className="underline font-medium"
                    >
                      sincronize
                    </a>{" "}
                    os templates aprovados na Meta.
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <Label className="text-xs">Template de utilidade</Label>
                    <Select
                      value={config.wa_template_id || ""}
                      onValueChange={(v) =>
                        setConfig({ ...config, wa_template_id: v || null })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um template" />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((t) => {
                          const statusColor =
                            t.status === "APPROVED"
                              ? "text-emerald-700"
                              : t.status === "REJECTED"
                              ? "text-red-700"
                              : "text-amber-700";
                          return (
                            <SelectItem key={t.id} value={t.id}>
                              <span className="flex items-center gap-2">
                                <span>{t.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  ({t.language})
                                </span>
                                <span
                                  className={`text-[10px] uppercase font-semibold ${statusColor}`}
                                >
                                  {t.status}
                                </span>
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      O botão na PDP só dispara quando o template estiver{" "}
                      <span className="font-semibold text-emerald-700">
                        APPROVED
                      </span>
                      . Pode salvar com PENDING — assim que a Meta aprovar,
                      começa a enviar automaticamente.
                    </p>
                  </div>

                  {selectedTemplate && (
                    <>
                      <div className="rounded border p-3 bg-slate-50 text-xs whitespace-pre-wrap font-mono">
                        {templateBody || "(sem corpo)"}
                      </div>

                      {templateSlotCount > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <Label className="text-xs">
                              Mapping de variáveis (slots {"{{1}}"} .. {"{{"}
                              {templateSlotCount}
                              {"}}"})
                            </Label>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => applyRecommendedMapping(false)}
                              >
                                Mapping recomendado
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => applyRecommendedMapping(true)}
                                title="Sem nome do solicitante na saudação"
                              >
                                Versão neutra
                              </Button>
                            </div>
                          </div>
                          {Array.from({ length: templateSlotCount }).map(
                            (_, i) => {
                              const pos = String(i + 1);
                              const raw = config.wa_variable_mapping[pos] || "";
                              const parsed = parseMappingValue(raw);
                              return (
                                <div
                                  key={pos}
                                  className="grid grid-cols-[60px_140px_1fr] gap-2 items-center"
                                >
                                  <div className="text-xs font-mono text-slate-500">
                                    {"{{"}
                                    {pos}
                                    {"}}"}
                                  </div>
                                  <Select
                                    value={parsed.kind}
                                    onValueChange={(kind) =>
                                      setMappingSlot(
                                        pos,
                                        encodeMappingValue(
                                          kind as "var" | "text",
                                          parsed.value
                                        )
                                      )
                                    }
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="var">Variável</SelectItem>
                                      <SelectItem value="text">Texto fixo</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {parsed.kind === "var" ? (
                                    <Select
                                      value={parsed.value}
                                      onValueChange={(v) =>
                                        setMappingSlot(
                                          pos,
                                          encodeMappingValue("var", v)
                                        )
                                      }
                                    >
                                      <SelectTrigger className="h-8 text-xs">
                                        <SelectValue placeholder="Variável" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {GIFT_REQUEST_VARS.map((v) => (
                                          <SelectItem key={v} value={v}>
                                            {v}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <Input
                                      className="h-8 text-xs"
                                      value={parsed.value}
                                      onChange={(e) =>
                                        setMappingSlot(
                                          pos,
                                          encodeMappingValue("text", e.target.value)
                                        )
                                      }
                                      placeholder="Texto literal (suporta {{var_name}})"
                                    />
                                  )}
                                </div>
                              );
                            }
                          )}
                          <div className="rounded border-2 border-dashed p-3 bg-emerald-50/50">
                            <div className="text-[10px] uppercase font-semibold text-emerald-700 mb-1 tracking-wider flex items-center gap-1">
                              <Sparkles className="w-3 h-3" /> Preview
                            </div>
                            <div className="text-xs whitespace-pre-wrap font-mono">
                              {previewBody}
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Botão na PDP</CardTitle>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Texto</Label>
                <Input
                  value={config.button_label}
                  onChange={(e) =>
                    setConfig({ ...config, button_label: e.target.value })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Ícone</Label>
                <Select
                  value={config.button_icon}
                  onValueChange={(v) => setConfig({ ...config, button_icon: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gift">🎁 Presente</SelectItem>
                    <SelectItem value="heart">❤ Coração</SelectItem>
                    <SelectItem value="sparkles">✨ Brilho</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Cor de fundo</Label>
                <Input
                  type="color"
                  value={config.button_bg_color}
                  onChange={(e) =>
                    setConfig({ ...config, button_bg_color: e.target.value })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Cor do texto</Label>
                <Input
                  type="color"
                  value={config.button_text_color}
                  onChange={(e) =>
                    setConfig({ ...config, button_text_color: e.target.value })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Border radius</Label>
                <Input
                  value={config.button_border_radius}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      button_border_radius: e.target.value,
                    })
                  }
                  placeholder="4px"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  style={{
                    background: config.button_bg_color,
                    color: config.button_text_color,
                    borderRadius: config.button_border_radius,
                    padding: "12px 18px",
                    fontWeight: 600,
                    fontSize: 14,
                    textTransform: "uppercase",
                    letterSpacing: ".02em",
                    border: 0,
                    width: "100%",
                  }}
                >
                  🎁 {config.button_label}
                </button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Modal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Título</Label>
                  <Input
                    value={config.modal_title}
                    onChange={(e) =>
                      setConfig({ ...config, modal_title: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs">CTA</Label>
                  <Input
                    value={config.modal_cta_label}
                    onChange={(e) =>
                      setConfig({ ...config, modal_cta_label: e.target.value })
                    }
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Subtítulo</Label>
                <Textarea
                  rows={2}
                  value={config.modal_subtitle}
                  onChange={(e) =>
                    setConfig({ ...config, modal_subtitle: e.target.value })
                  }
                />
              </div>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs">Label nome</Label>
                  <Input
                    value={config.modal_name_label}
                    onChange={(e) =>
                      setConfig({ ...config, modal_name_label: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs">Label WhatsApp</Label>
                  <Input
                    value={config.modal_phone_label}
                    onChange={(e) =>
                      setConfig({ ...config, modal_phone_label: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs">Label mensagem</Label>
                  <Input
                    value={config.modal_message_label}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        modal_message_label: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Título do sucesso</Label>
                  <Input
                    value={config.modal_success_title}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        modal_success_title: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs">Mensagem de sucesso</Label>
                  <Input
                    value={config.modal_success_message}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        modal_success_message: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={config.collect_requester_phone}
                  onCheckedChange={(v) =>
                    setConfig({ ...config, collect_requester_phone: v })
                  }
                />
                <Label className="text-sm">
                  Pedir também o WhatsApp de quem está solicitando (opcional, não
                  é enviado pra ninguém — só ajuda no contato reverso)
                </Label>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-3 sticky bottom-4 bg-white/80 backdrop-blur p-3 border rounded shadow-sm">
            {saved && (
              <span className="text-sm text-emerald-700 flex items-center gap-1">
                <Check className="w-4 h-4" /> Salvo
              </span>
            )}
            <Button
              onClick={saveConfig}
              disabled={saving || !workspace?.id}
              size="lg"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Salvar configuração
            </Button>
          </div>
        </TabsContent>

        {/* ============================== REQUESTS ============================== */}
        <TabsContent value="requests" className="space-y-4">
          <div className="flex items-center gap-3">
            <Select
              value={statusFilter || "all"}
              onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Todos os status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {Object.entries(STATUS_META).map(([k, m]) => (
                  <SelectItem key={k} value={k}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={loadAll}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </Button>
          </div>

          {requests.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Nenhuma solicitação ainda.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                    <tr>
                      <th className="text-left p-3">Quando</th>
                      <th className="text-left p-3">Solicitante</th>
                      <th className="text-left p-3">Presenteado</th>
                      <th className="text-left p-3">Produto</th>
                      <th className="text-left p-3">Status</th>
                      <th className="text-left p-3">Entregue</th>
                      <th className="text-left p-3">Lido</th>
                      <th className="text-left p-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => {
                      const status = r.wa_status || r.status;
                      const meta = STATUS_META[status] || STATUS_META.queued;
                      const Icon = meta.Icon;
                      return (
                        <tr key={r.id} className="border-t hover:bg-slate-50">
                          <td className="p-3 text-xs">
                            {fmtDateTime(r.created_at)}
                          </td>
                          <td className="p-3">
                            <div className="font-medium">{r.requester_name}</div>
                            {r.requester_phone && (
                              <div className="text-xs text-muted-foreground">
                                {r.requester_phone}
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-xs font-mono">
                            {r.recipient_phone}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              {r.product_image_url && (
                                <img
                                  src={r.product_image_url}
                                  alt=""
                                  className="w-10 h-10 rounded object-cover"
                                />
                              )}
                              <div className="min-w-0">
                                <div
                                  className="text-xs font-medium truncate max-w-[200px]"
                                  title={r.product_name || r.product_id}
                                >
                                  {r.product_name || r.product_id}
                                </div>
                                {r.product_url && (
                                  <a
                                    href={r.product_url}
                                    target="_blank"
                                    rel="noopener"
                                    className="text-[10px] text-blue-600 underline"
                                  >
                                    abrir
                                  </a>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="p-3">
                            <span
                              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${meta.color}`}
                            >
                              <Icon className="w-3 h-3" />
                              {meta.label}
                            </span>
                            {r.wa_error && (
                              <div className="text-[10px] text-red-600 mt-1">
                                {r.wa_error}
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {fmtDateTime(r.delivered_at)}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {fmtDateTime(r.read_at)}
                          </td>
                          <td className="p-3">
                            {r.personal_message && (
                              <details className="text-xs">
                                <summary className="cursor-pointer text-slate-500">
                                  msg
                                </summary>
                                <div className="mt-1 p-2 bg-slate-50 rounded max-w-[260px] whitespace-pre-wrap">
                                  {r.personal_message}
                                </div>
                              </details>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ============================== ANALYTICS ============================== */}
        <TabsContent value="analytics" className="space-y-4">
          {!stats ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">
                      Solicitações (90d)
                    </div>
                    <div className="text-2xl font-bold mt-1">{stats.total}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">Lidas</div>
                    <div className="text-2xl font-bold mt-1">
                      {stats.read}{" "}
                      <span className="text-sm font-normal text-muted-foreground">
                        ({fmtPercent(stats.read_rate)})
                      </span>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">
                      Convertidas
                    </div>
                    <div className="text-2xl font-bold mt-1">
                      {stats.converted}{" "}
                      <span className="text-sm font-normal text-muted-foreground">
                        ({fmtPercent(stats.conversion_rate)})
                      </span>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">Falharam</div>
                    <div className="text-2xl font-bold mt-1 text-red-700">
                      {stats.by_status.failed || 0}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Top produtos pedidos</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {stats.top_products.length === 0 ? (
                    <div className="p-6 text-sm text-muted-foreground text-center">
                      Sem dados ainda.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                        <tr>
                          <th className="text-left p-3">Produto</th>
                          <th className="text-right p-3">Pedidos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.top_products.map((p) => (
                          <tr key={p.product_id} className="border-t">
                            <td className="p-3 font-mono text-xs">
                              {p.product_id}
                            </td>
                            <td className="p-3 text-right font-medium">
                              {p.count}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
