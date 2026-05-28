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
  Stethoscope,
  Users,
  ExternalLink,
  Download,
  Settings as SettingsIcon,
  LayoutDashboard,
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
  const [tab, setTab] = useState("dashboard");

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
  const [diagnosing, setDiagnosing] = useState(false);
  const [syncingLeads, setSyncingLeads] = useState(false);
  const [leads, setLeads] = useState<{
    total_leads: number;
    total_requests: number;
    leads: Array<{
      requester_name: string;
      requester_phone: string;
      first_request_at: string;
      last_request_at: string;
      request_count: number;
      converted_count: number;
      total_desired_value: number;
      products: Array<{
        id: string;
        name: string | null;
        url: string | null;
        image_url: string | null;
        price: number | null;
        requested_at: string;
        status: string;
      }>;
    }>;
    top_products: Array<{
      product_id: string;
      product_name: string | null;
      product_url: string | null;
      product_image_url: string | null;
      product_price: number | null;
      request_count: number;
      unique_requesters: number;
    }>;
    crm_list: {
      id: string;
      name: string;
      total_count: number;
      phone_count: number;
      updated_at: string;
    } | null;
  } | null>(null);
  const [diagnose, setDiagnose] = useState<{
    all_ok: boolean;
    checks: Array<{ ok: boolean; label: string; detail?: string }>;
    config_summary: Record<string, unknown> | null;
    template_summary: Record<string, unknown> | null;
    api_key_sample: { id: string; name: string; key_preview: string } | null;
    recent_requests: Array<{
      id: string;
      status: string;
      created_at: string;
      recipient_phone: string;
      error_message: string | null;
      wa_status: string | null;
      wa_meta_message_id: string | null;
      wa_sent_at: string | null;
      wa_delivered_at: string | null;
      wa_read_at: string | null;
      wa_variables: Record<string, string> | null;
    }>;
  } | null>(null);

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

  const loadLeads = useCallback(async () => {
    if (!workspace?.id) return;
    try {
      const res = await fetch("/api/gift-request/leads-insights", {
        headers: headers(),
      });
      const data = await res.json();
      if (res.ok) setLeads(data);
    } catch (e) {
      console.error("leads load:", e);
    }
  }, [workspace?.id, headers]);

  useEffect(() => {
    if (workspace?.id) {
      loadAll();
      loadLeads();
    }
  }, [workspace?.id, loadAll, loadLeads]);

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

  async function retryRequest(id: string) {
    if (!workspace?.id) return;
    if (!confirm("Reenfileirar esse pedido pra envio?")) return;
    try {
      const res = await fetch(`/api/gift-request/retry/${id}`, {
        method: "POST",
        headers: headers(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao retentar");
      await runDiagnose();
      alert(
        "Pedido reenfileirado. O próximo tick do cron (5min) tenta enviar de novo."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao retentar");
    }
  }


  async function syncLeadsToCrm() {
    if (!workspace?.id) return;
    setSyncingLeads(true);
    setError(null);
    try {
      const res = await fetch("/api/gift-request/sync-leads", {
        method: "POST",
        headers: headers(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao sincronizar");
      await loadLeads();
      alert(
        `Sincronização concluída — ${data.added} contato(s) capturado(s) na lista CRM "Pedidos de presente".`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao sincronizar");
    } finally {
      setSyncingLeads(false);
    }
  }

  async function runDiagnose() {
    if (!workspace?.id) return;
    setDiagnosing(true);
    setError(null);
    try {
      const res = await fetch("/api/gift-request/diagnose", {
        headers: headers(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao diagnosticar");
      setDiagnose(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao diagnosticar");
    } finally {
      setDiagnosing(false);
    }
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
          <TabsTrigger value="dashboard" className="gap-1.5">
            <LayoutDashboard className="w-3.5 h-3.5" /> Dashboard
          </TabsTrigger>
          <TabsTrigger
            value="leads"
            className="gap-1.5"
            onClick={() => {
              if (!leads) loadLeads();
            }}
          >
            <Users className="w-3.5 h-3.5" /> Leads CRM
          </TabsTrigger>
          <TabsTrigger
            value="settings"
            className="gap-1.5 ml-auto text-muted-foreground data-[state=active]:text-foreground"
          >
            <SettingsIcon className="w-3.5 h-3.5" /> Configurações
          </TabsTrigger>
        </TabsList>

        {/* ============================== SETTINGS ============================== */}
        <TabsContent value="settings" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Stethoscope className="w-4 h-4" /> Diagnóstico
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={runDiagnose}
                  disabled={diagnosing}
                >
                  {diagnosing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-1" />
                  )}
                  Diagnosticar
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!diagnose ? (
                <p className="text-sm text-muted-foreground">
                  Clica em "Diagnosticar" pra ver porque o botão pode não estar
                  aparecendo na PDP (config, template, credenciais, API key).
                </p>
              ) : (
                <div className="space-y-3">
                  <div
                    className={`text-sm font-medium ${
                      diagnose.all_ok ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    {diagnose.all_ok
                      ? "✓ Tudo OK — botão deve aparecer na PDP."
                      : "✗ Alguns problemas encontrados:"}
                  </div>
                  <ul className="space-y-2">
                    {diagnose.checks.map((c, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm"
                      >
                        {c.ok ? (
                          <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 mt-0.5 text-red-600 shrink-0" />
                        )}
                        <div>
                          <div className={c.ok ? "" : "font-medium"}>
                            {c.label}
                          </div>
                          {c.detail && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {c.detail}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>

                  {diagnose.api_key_sample && (
                    <div className="text-xs text-muted-foreground border-t pt-2 mt-2">
                      API key: <code>{diagnose.api_key_sample.key_preview}</code>{" "}
                      ({diagnose.api_key_sample.name})
                    </div>
                  )}

                  {diagnose.recent_requests.length > 0 && (
                    <div className="border-t pt-3 mt-3">
                      <div className="text-xs font-semibold text-muted-foreground mb-2">
                        Últimos 10 pedidos
                      </div>
                      <div className="space-y-2">
                        {diagnose.recent_requests.map((r) => {
                          const realStatus = r.wa_status || r.status;
                          return (
                            <div
                              key={r.id}
                              className="text-xs border rounded p-2 bg-slate-50"
                            >
                              <div className="flex items-center gap-2 font-mono">
                                <span className="text-muted-foreground">
                                  {new Date(r.created_at).toLocaleString(
                                    "pt-BR",
                                    {
                                      dateStyle: "short",
                                      timeStyle: "short",
                                    }
                                  )}
                                </span>
                                <Badge
                                  variant={
                                    realStatus === "failed"
                                      ? "destructive"
                                      : realStatus === "read" ||
                                        realStatus === "delivered"
                                      ? "default"
                                      : "secondary"
                                  }
                                >
                                  {realStatus}
                                </Badge>
                                <span>{r.recipient_phone}</span>
                                {r.wa_meta_message_id && (
                                  <span
                                    className="text-muted-foreground truncate"
                                    title={r.wa_meta_message_id}
                                  >
                                    msg:{r.wa_meta_message_id.slice(0, 12)}…
                                  </span>
                                )}
                              </div>
                              {r.error_message && (
                                <div className="text-red-600 mt-1 flex items-start justify-between gap-2">
                                  <div className="flex-1 break-all">
                                    ⚠ {r.error_message}
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="shrink-0 h-7 text-[10px]"
                                    onClick={() => retryRequest(r.id)}
                                  >
                                    <RefreshCw className="w-3 h-3 mr-1" />
                                    Tentar de novo
                                  </Button>
                                </div>
                              )}
                              {(r.wa_sent_at ||
                                r.wa_delivered_at ||
                                r.wa_read_at) && (
                                <div className="text-muted-foreground mt-1 flex gap-3">
                                  {r.wa_sent_at && (
                                    <span>sent: {fmtDateTime(r.wa_sent_at)}</span>
                                  )}
                                  {r.wa_delivered_at && (
                                    <span>
                                      delivered: {fmtDateTime(r.wa_delivered_at)}
                                    </span>
                                  )}
                                  {r.wa_read_at && (
                                    <span>read: {fmtDateTime(r.wa_read_at)}</span>
                                  )}
                                </div>
                              )}
                              {r.wa_variables && (
                                <details className="mt-1">
                                  <summary className="cursor-pointer text-muted-foreground">
                                    variáveis enviadas
                                  </summary>
                                  <pre className="text-[10px] mt-1 p-2 bg-white border rounded whitespace-pre-wrap">
                                    {JSON.stringify(r.wa_variables, null, 2)}
                                  </pre>
                                </details>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <details className="text-xs text-muted-foreground mt-2">
                    <summary className="cursor-pointer">Debug do navegador</summary>
                    <p className="mt-2">
                      Se diagnóstico passou e ainda não aparece: abra o DevTools
                      (F12) na PDP da loja, aba Console, e procure por linhas
                      começando com{" "}
                      <code className="font-mono">[GiftRequest]</code>. Elas
                      mostram pageType, productId, status da chamada ao
                      /public-config e se a âncora foi encontrada.
                    </p>
                  </details>
                </div>
              )}
            </CardContent>
          </Card>

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
                      Cria <code className="font-mono">bkng_share_message_v…</code>{" "}
                      com body neutro ("Oi, tudo bem? {"{{1}}"} {"{{2}}"}...")
                      e já linka aqui com o mapping recomendado. Se a Meta
                      reclassificar pra MARKETING depois, é só clicar de novo
                      pra criar uma nova versão.
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
                          <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700 leading-relaxed">
                            <strong>Regra da Meta:</strong> textos fixos das
                            variáveis não podem conter quebra de linha (
                            <code className="font-mono">\n</code>), tab ou mais
                            de 4 espaços. Use travessões (—) ou pontuação. As
                            quebras de leitura entre os slots vêm do body do
                            template (acima).
                          </div>
                          {Array.from({ length: templateSlotCount }).map(
                            (_, i) => {
                              const pos = String(i + 1);
                              const raw = config.wa_variable_mapping[pos] || "";
                              const parsed = parseMappingValue(raw);
                              return (
                                <div
                                  key={pos}
                                  className="border rounded-md p-3 bg-white space-y-2"
                                >
                                  <div className="flex items-center gap-2">
                                    <div className="text-xs font-mono text-slate-500 w-12">
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
                                      <SelectTrigger className="h-8 text-xs w-[140px]">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="var">
                                          Variável
                                        </SelectItem>
                                        <SelectItem value="text">
                                          Texto fixo
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
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
                                    <>
                                      <Textarea
                                        className="text-xs font-mono"
                                        rows={3}
                                        value={parsed.value}
                                        onChange={(e) =>
                                          setMappingSlot(
                                            pos,
                                            encodeMappingValue(
                                              "text",
                                              // sanitiza: troca \n por espaço pra
                                              // evitar salvamento inválido. user
                                              // ainda pode digitar — a UI converte
                                              e.target.value.replace(/[\n\t]/g, " ")
                                            )
                                          )
                                        }
                                        placeholder="Texto literal (suporta {{var_name}})"
                                      />
                                      {/\n|\t/.test(parsed.value) && (
                                        <p className="text-[10px] text-red-700">
                                          ⚠ Quebras de linha serão convertidas em
                                          espaço.
                                        </p>
                                      )}
                                    </>
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

        {/* ============================== DASHBOARD ============================== */}
        <TabsContent value="dashboard" className="space-y-5">
          {/* KPIs principais */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">
                  Solicitações (90d)
                </div>
                <div className="text-3xl font-bold mt-1">
                  {stats?.total ?? "—"}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">
                  Lidas
                </div>
                <div className="text-3xl font-bold mt-1">
                  {stats?.read ?? "—"}
                </div>
                {stats && stats.total > 0 && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {fmtPercent(stats.read_rate)} de leitura
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">
                  Convertidas
                </div>
                <div className="text-3xl font-bold mt-1">
                  {stats?.converted ?? "—"}
                </div>
                {stats && stats.total > 0 && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {fmtPercent(stats.conversion_rate)} de conversão
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">
                  Falhas
                </div>
                <div className="text-3xl font-bold mt-1">
                  {stats?.by_status?.failed ?? "—"}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">
                  Leads únicos
                </div>
                <div className="text-3xl font-bold mt-1">
                  {leads?.total_leads ?? "—"}
                </div>
                {leads?.total_leads ? (
                  <button
                    onClick={() => setTab("leads")}
                    className="text-xs text-blue-600 underline mt-0.5"
                  >
                    ver leads
                  </button>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {/* Status breakdown horizontal */}
          {stats && stats.total > 0 && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-muted-foreground uppercase tracking-wider">
                    Status:
                  </span>
                  {Object.entries(STATUS_META).map(([k, m]) => {
                    const count = stats.by_status?.[k] || 0;
                    if (count === 0) return null;
                    const Icon = m.Icon;
                    return (
                      <span
                        key={k}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${m.color}`}
                      >
                        <Icon className="w-3 h-3" />
                        {count} {m.label.toLowerCase()}
                      </span>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Header da tabela */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold">Solicitações</h2>
              <p className="text-xs text-muted-foreground">
                Cada pedido feito a partir da PDP da loja
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={statusFilter || "all"}
                onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-[180px] h-9">
                  <SelectValue placeholder="Todos os status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
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
          </div>

          {requests.length === 0 ? (
            <Card>
              <CardContent className="py-14 text-center">
                <Gift className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <div className="text-sm font-medium text-slate-700">
                  Nenhuma solicitação ainda
                </div>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                  Quando alguém clicar em "Pedir de presente" na PDP da sua
                  loja, aparece aqui em tempo real.
                </p>
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

        {/* ============================== LEADS CRM ============================== */}
        <TabsContent value="leads" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4" /> Solicitantes capturados como leads
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={syncLeadsToCrm}
                    disabled={syncingLeads}
                  >
                    {syncingLeads ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4 mr-1" />
                    )}
                    Sincronizar retroativos
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={loadLeads}
                    disabled={!workspace?.id}
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Cada solicitante vira contato na lista CRM{" "}
                <strong>"Pedidos de presente"</strong> automaticamente, com
                nome, WhatsApp e o produto que desejou. Use pra criar
                campanhas WhatsApp/Email direcionadas — quem pediu sabe
                exatamente o que quer.
              </p>

              {leads?.crm_list ? (
                <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <div>
                      Lista CRM{" "}
                      <code className="font-mono">"{leads.crm_list.name}"</code>{" "}
                      tem <strong>{leads.crm_list.total_count}</strong>{" "}
                      contato(s).
                    </div>
                  </div>
                  <Link
                    href="/crm/listas"
                    className="text-xs underline font-medium flex items-center gap-1"
                  >
                    Ver lista <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              ) : (
                <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 mb-4">
                  Lista CRM ainda não criada — vai ser gerada automaticamente
                  no primeiro pedido com WhatsApp, ou clique em{" "}
                  <strong>"Sincronizar retroativos"</strong> pra capturar os
                  já existentes.
                </div>
              )}

              {!leads ? (
                <div className="py-10 text-center">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </div>
              ) : leads.leads.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Nenhum lead capturado ainda.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                    <Card>
                      <CardContent className="p-3">
                        <div className="text-xs text-muted-foreground">
                          Leads únicos
                        </div>
                        <div className="text-2xl font-bold mt-1">
                          {leads.total_leads}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-3">
                        <div className="text-xs text-muted-foreground">
                          Solicitações totais
                        </div>
                        <div className="text-2xl font-bold mt-1">
                          {leads.total_requests}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-3">
                        <div className="text-xs text-muted-foreground">
                          Pedidos por lead (média)
                        </div>
                        <div className="text-2xl font-bold mt-1">
                          {leads.total_leads
                            ? (leads.total_requests / leads.total_leads).toFixed(
                                1
                              )
                            : "0"}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="border-t pt-3">
                    <h4 className="text-sm font-semibold mb-3">
                      Quem mais pediu
                    </h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                          <tr>
                            <th className="text-left p-2">Nome</th>
                            <th className="text-left p-2">WhatsApp</th>
                            <th className="text-left p-2">Pedidos</th>
                            <th className="text-left p-2">
                              Valor desejado
                            </th>
                            <th className="text-left p-2">Primeira vez</th>
                            <th className="text-left p-2">Produtos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {leads.leads.map((l) => (
                            <tr
                              key={l.requester_phone}
                              className="border-t hover:bg-slate-50"
                            >
                              <td className="p-2 font-medium">
                                {l.requester_name}
                              </td>
                              <td className="p-2 font-mono text-xs">
                                {l.requester_phone}
                              </td>
                              <td className="p-2">
                                <Badge variant="secondary">
                                  {l.request_count}
                                </Badge>
                              </td>
                              <td className="p-2 text-xs">
                                {l.total_desired_value
                                  ? `R$ ${l.total_desired_value.toFixed(2)}`
                                  : "—"}
                              </td>
                              <td className="p-2 text-xs text-muted-foreground">
                                {new Date(
                                  l.first_request_at
                                ).toLocaleDateString("pt-BR")}
                              </td>
                              <td className="p-2">
                                <details className="text-xs">
                                  <summary className="cursor-pointer text-slate-600">
                                    {l.products.length} produto(s)
                                  </summary>
                                  <ul className="mt-1 space-y-1">
                                    {l.products.slice(0, 5).map((p, i) => (
                                      <li
                                        key={i}
                                        className="flex items-center gap-2 text-[11px]"
                                      >
                                        {p.image_url && (
                                          <img
                                            src={p.image_url}
                                            alt=""
                                            className="w-6 h-6 rounded object-cover"
                                          />
                                        )}
                                        <span className="truncate max-w-[200px]">
                                          {p.name || p.id}
                                        </span>
                                        {p.url && (
                                          <a
                                            href={p.url}
                                            target="_blank"
                                            rel="noopener"
                                            className="text-blue-600 underline"
                                          >
                                            ↗
                                          </a>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {leads && leads.top_products.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> Top produtos mais
                  desejados
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                    <tr>
                      <th className="text-left p-2">Produto</th>
                      <th className="text-right p-2">Pedidos</th>
                      <th className="text-right p-2">Pessoas únicas</th>
                      <th className="text-right p-2">Preço</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.top_products.map((p) => (
                      <tr key={p.product_id} className="border-t">
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            {p.product_image_url && (
                              <img
                                src={p.product_image_url}
                                alt=""
                                className="w-8 h-8 rounded object-cover"
                              />
                            )}
                            <div className="min-w-0">
                              <div className="text-xs font-medium truncate max-w-[260px]">
                                {p.product_name || p.product_id}
                              </div>
                              {p.product_url && (
                                <a
                                  href={p.product_url}
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
                        <td className="p-2 text-right font-medium">
                          {p.request_count}
                        </td>
                        <td className="p-2 text-right text-muted-foreground">
                          {p.unique_requesters}
                        </td>
                        <td className="p-2 text-right text-xs">
                          {p.product_price
                            ? `R$ ${p.product_price.toFixed(2)}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

      </Tabs>
    </div>
  );
}
