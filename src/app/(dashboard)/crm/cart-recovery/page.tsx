"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";
import { CartRecoveryJourneyWorkflow } from "@/components/cart-recovery/journey-workflow";
import {
  ShoppingCart,
  Plus,
  Trash2,
  Save,
  Copy,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  MessageCircle,
  Mail,
  Webhook,
  Eye,
  Sparkles,
  AlertCircle,
  Pencil,
  Zap,
  RefreshCw,
  Gift,
  Download,
  User,
  Package,
  ExternalLink,
  Phone,
  Hash,
} from "lucide-react";
import {
  SAMPLE_VARS,
  encodeMappingValue,
  interpolate,
  parseMappingValue,
  previewWhatsAppBody,
} from "@/lib/cart-recovery/variables";

const AVAILABLE_VARS = [
  "customer_name",
  "customer_first_name",
  "customer_email",
  "customer_state",
  "customer_region",
  "cart_total",
  "cart_total_formatted",
  "first_item_name",
  "items_count",
  "recovery_url",
  "coupon_code",
  "coupon_expires_at_formatted",
  "free_shipping_message",
  "free_shipping_whatsapp_block",
  "free_shipping_email_block",
  "store_name",
];

interface WaTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: Array<{ type: string; text?: string }>;
}

interface Step {
  id?: string;
  step_order: number;
  delay_minutes: number;
  whatsapp_enabled: boolean;
  whatsapp_template_id: string | null;
  whatsapp_variable_mapping: Record<string, string>;
  email_enabled: boolean;
  email_subject: string | null;
  email_body_html: string | null;
  coupon_pct: number;
  coupon_validity_hours: number;
}

interface Rule {
  id: string;
  enabled: boolean;
  expire_after_hours: number;
}

interface CartRow {
  id: string;
  vnda_cart_token: string | null;
  customer_email: string;
  customer_name: string | null;
  customer_state: string | null;
  customer_region: string | null;
  cart_total: number | null;
  status: string;
  abandoned_at: string;
  recovered_at: string | null;
  recovery_url: string | null;
  items: Array<{ name: string | null }> | null;
  coupon_code: string | null;
  recovery_coupon_expires_at: string | null;
  recovery_started_at: string | null;
  steps_sent: number;
  steps_total: number;
}

interface CartItemDetail {
  name: string | null;
  sku: string | null;
  quantity: number;
  price: number | null;
  image_url: string | null;
}

interface CartDetail extends CartRow {
  vnda_cart_id: string | null;
  vnda_client_id: number | null;
  customer_phone: string | null;
  items: CartItemDetail[] | null;
  closed_at: string | null;
  enrichment_attempted_at: string | null;
}

interface DetailStep {
  id: string;
  step_order: number;
  delay_minutes: number;
  whatsapp_enabled: boolean;
  email_enabled: boolean;
  coupon_pct: number;
  coupon_validity_hours: number;
}

interface DetailMessage {
  step_id: string;
  channel: "whatsapp" | "email";
  status: string;
  error: string | null;
  external_id: string | null;
  sent_at: string;
  rendered_payload: {
    // WhatsApp
    template_name?: string;
    language?: string;
    phone?: string;
    variables?: Record<string, string>;
    body?: string;
    // Email
    to?: string;
    subject?: string;
    body_html?: string;
  } | null;
}

interface CartDetailResponse {
  cart: CartDetail;
  steps: DetailStep[];
  messages: DetailMessage[];
  expire_after_hours: number | null;
}

interface StatusAgg {
  count: number;
  value: number;
}

interface KpisResponse {
  totals: {
    open: StatusAgg;
    recovered: StatusAgg;
    expired: StatusAgg;
    closed: StatusAgg;
  };
  by_step: Array<{ step_order: number; count: number; value: number }>;
  coupon_breakdown: {
    coupon_sent_used: StatusAgg;
    coupon_sent_unused: StatusAgg;
    no_coupon_sent: StatusAgg;
  };
  total_carts: number;
  conversion_pct: number;
}

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function emptyStep(order: number): Step {
  return {
    step_order: order,
    delay_minutes: order === 1 ? 30 : order === 2 ? 1440 : 4320,
    whatsapp_enabled: false,
    whatsapp_template_id: null,
    whatsapp_variable_mapping: {},
    email_enabled: false,
    email_subject: null,
    email_body_html: null,
    coupon_pct: 0,
    coupon_validity_hours: 48,
  };
}

function extractTemplateVars(tpl: WaTemplate | undefined): string[] {
  if (!tpl) return [];
  const bodyText = getTemplateBody(tpl);
  const matches = bodyText.match(/\{\{\s*\d+\s*\}\}/g) || [];
  const positions = matches
    .map((m) => m.replace(/[^\d]/g, ""))
    .filter((p) => p);
  return Array.from(new Set(positions)).sort();
}

function getTemplateBody(tpl: WaTemplate | undefined): string {
  if (!tpl) return "";
  return tpl.components.find((c) => c.type === "BODY")?.text || "";
}

function formatDelay(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

function stepHasCartUrl(step: Step): boolean {
  if (step.whatsapp_enabled) {
    const hasWaLink = Object.values(step.whatsapp_variable_mapping || {}).some(
      (v) => v === "recovery_url" || v === "var:recovery_url" ||
             (v.startsWith("text:") && v.includes("{{recovery_url}}"))
    );
    if (!hasWaLink) return false;
  }
  if (step.email_enabled) {
    const hay = `${step.email_subject || ""} ${step.email_body_html || ""}`;
    if (!hay.includes("{{recovery_url}}") && !hay.includes("{{cart_url}}")) {
      return false;
    }
  }
  return true;
}

export default function CartRecoveryPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applyingRecommended, setApplyingRecommended] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [refreshingTemplate, setRefreshingTemplate] = useState(false);
  const [importingFromVnda, setImportingFromVnda] = useState(false);
  const [importHours, setImportHours] = useState(48);
  const [cartDetail, setCartDetail] = useState<CartDetailResponse | null>(null);
  const [loadingCartDetail, setLoadingCartDetail] = useState(false);
  const [kpis, setKpis] = useState<KpisResponse | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  const diagnoseOpenCarts = async () => {
    if (!workspaceId) return;
    setDiagnosing(true);
    try {
      const res = await fetch("/api/crm/cart-recovery/diagnose", {
        headers: { "x-workspace-id": workspaceId },
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Erro ao diagnosticar");
        return;
      }
      const str = JSON.stringify(data, null, 2);
      console.warn("[CartRecovery Diagnose]", data);
      try {
        await navigator.clipboard.writeText(str);
      } catch {}
      const verdictText = (data.verdict || []).join("\n• ");
      alert(
        `Diagnóstico:\n\n• ${verdictText}\n\n✅ Detalhe completo copiado pro clipboard.`
      );
    } finally {
      setDiagnosing(false);
    }
  };
  const [rule, setRule] = useState<Rule>({
    id: "",
    enabled: false,
    expire_after_hours: 168,
  });
  const [steps, setSteps] = useState<Step[]>([]);
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [carts, setCarts] = useState<CartRow[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [webhookToken, setWebhookToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const headers = { "x-workspace-id": workspaceId };
      const [ruleRes, tplRes, cartsRes, kpisRes] = await Promise.all([
        fetch("/api/crm/cart-recovery/rule", { headers }),
        fetch("/api/crm/whatsapp/templates", { headers }),
        fetch("/api/crm/cart-recovery/carts?limit=50", { headers }),
        fetch("/api/crm/cart-recovery/kpis", { headers }),
      ]);

      const ruleData = await ruleRes.json();
      if (ruleData.rule) {
        setRule({
          id: ruleData.rule.id,
          enabled: ruleData.rule.enabled,
          expire_after_hours: ruleData.rule.expire_after_hours,
        });
      }
      setSteps(ruleData.steps || []);
      setWebhookToken(ruleData.webhook_token || null);

      const tplData = await tplRes.json();
      setTemplates(tplData.templates || []);

      const cartsData = await cartsRes.json();
      setCarts(cartsData.carts || []);
      setSummary(cartsData.summary || {});

      if (kpisRes.ok) {
        const kpisData = await kpisRes.json();
        setKpis(kpisData);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const addStep = () => {
    setSteps((prev) => {
      const next = [...prev, emptyStep(prev.length + 1)];
      setEditingIdx(next.length - 1);
      return next;
    });
  };

  const removeStep = (idx: number) => {
    if (!window.confirm("Remover esse step?")) return;
    setSteps((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, step_order: i + 1 }))
    );
    setEditingIdx(null);
  };

  const updateStep = (idx: number, patch: Partial<Step>) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s))
    );
  };

  const applyRecommended = async () => {
    if (!workspaceId) return;
    const ok = window.confirm(
      "Vamos aplicar a régua recomendada (3 steps: 30min, 24h, 72h, WhatsApp + Email cada). Os steps atuais serão arquivados com todo o histórico preservado. Continuar?"
    );
    if (!ok) return;
    setApplyingRecommended(true);
    try {
      const res = await fetch("/api/crm/cart-recovery/apply-recommended", {
        method: "POST",
        headers: { "x-workspace-id": workspaceId },
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Erro ao aplicar régua recomendada");
      } else {
        await fetchAll();
      }
    } finally {
      setApplyingRecommended(false);
    }
  };

  const openCartDetail = async (cartId: string) => {
    if (!workspaceId) return;
    setCartDetail(null);
    setLoadingCartDetail(true);
    try {
      const res = await fetch(`/api/crm/cart-recovery/carts/${cartId}`, {
        headers: { "x-workspace-id": workspaceId },
      });
      const data = await res.json();
      if (res.ok) {
        setCartDetail(data);
      } else {
        alert(data.error || "Erro ao carregar detalhe do carrinho");
      }
    } finally {
      setLoadingCartDetail(false);
    }
  };

  const refreshTemplateStatus = async () => {
    if (!workspaceId) return;
    setRefreshingTemplate(true);
    try {
      const res = await fetch("/api/crm/cart-recovery/refresh-template", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || data.error || "Erro ao atualizar status");
      } else {
        if (data.changed) {
          alert(
            `Status atualizado: ${data.previous_status || "?"} → ${data.status}`
          );
        }
        await fetchAll();
      }
    } finally {
      setRefreshingTemplate(false);
    }
  };

  const importFromVnda = async () => {
    if (!workspaceId) return;
    const ok = window.confirm(
      `Vou puxar os carrinhos abandonados das últimas ${importHours}h direto da API VNDA e injetar na régua. Cada cart vai começar a régua do começo (step 1) assim que entrar. Continuar?`
    );
    if (!ok) return;
    setImportingFromVnda(true);
    try {
      const res = await fetch("/api/crm/cart-recovery/import-from-vnda", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({ hours: importHours }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Erro ao importar carrinhos");
      } else {
        let copiedHint = "";
        if (data.sample_invalid?.length) {
          const sampleStr = JSON.stringify(data.sample_invalid, null, 2);
          console.warn(
            "[CartRecovery Import] Amostras dos carts inválidos:\n" + sampleStr
          );
          try {
            await navigator.clipboard.writeText(sampleStr);
            copiedHint =
              "\n\n✅ Amostras dos inválidos COPIADAS pro clipboard — cola no chat com Cmd+V.";
          } catch {
            copiedHint =
              "\n\nAmostras dos inválidos foram logadas no console do navegador (F12).";
          }
        }
        alert(
          `Importação concluída:\n\n` +
            `• Importados: ${data.imported}\n` +
            `• Já existiam: ${data.skipped_existing}\n` +
            `• Sem email: ${data.skipped_no_email}\n` +
            `• Inválidos: ${data.skipped_invalid}\n` +
            `• Fora da janela: ${data.skipped_outside_window || 0}\n` +
            `• Erros: ${data.errors}\n` +
            `• Total varredo: ${data.fetched}` +
            copiedHint
        );
        await fetchAll();
      }
    } finally {
      setImportingFromVnda(false);
    }
  };

  const createUtilityTemplate = async () => {
    if (!workspaceId) return;
    const ok = window.confirm(
      "Vou criar um template UTILITY genérico na Meta (body só com placeholders) e linkar a todos os steps com WhatsApp ativo. UTILITY custa ~10x menos que MARKETING. A aprovação Meta geralmente sai em minutos. Continuar?"
    );
    if (!ok) return;
    setCreatingTemplate(true);
    try {
      const res = await fetch(
        "/api/crm/cart-recovery/create-utility-template",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-workspace-id": workspaceId,
          },
          body: JSON.stringify({ apply_to_steps: true }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Erro ao criar template UTILITY");
      } else {
        alert(data.message || "Template criado");
        await fetchAll();
      }
    } finally {
      setCreatingTemplate(false);
    }
  };

  const save = async () => {
    if (!workspaceId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/crm/cart-recovery/rule", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          enabled: rule.enabled,
          expire_after_hours: rule.expire_after_hours,
          steps,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Erro ao salvar");
      } else {
        await fetchAll();
      }
    } finally {
      setSaving(false);
    }
  };

  const webhookUrl = webhookToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/vnda/abandoned-cart?token=${webhookToken}`
    : null;

  const copyWebhook = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Template UTILITY já criado pra essa régua? (heurística: algum step
  // tem template selecionado E o template tem categoria UTILITY)
  const linkedTemplate = (() => {
    for (const s of steps) {
      if (s.whatsapp_enabled && s.whatsapp_template_id) {
        const t = templates.find((t) => t.id === s.whatsapp_template_id);
        if (t) return t;
      }
    }
    return null;
  })();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-6 w-6" />
            Recuperação de Carrinho
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Régua automática de WhatsApp e Email pra trazer o cliente de volta.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={rule.enabled}
              onCheckedChange={(v) => setRule((r) => ({ ...r, enabled: v }))}
            />
            <span className="text-sm font-medium">
              {rule.enabled ? "Ativa" : "Desativada"}
            </span>
          </div>
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Salvar
          </Button>
        </div>
      </div>

      {/* KPIs ricos: totais + conversão por etapa + cupom */}
      <KpisSection
        kpis={kpis}
        fallbackSummary={summary}
        onDiagnose={diagnoseOpenCarts}
        diagnosing={diagnosing}
      />


      <Tabs defaultValue="journey">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="journey">Jornada inteligente</TabsTrigger>
          <TabsTrigger value="rule">Régua</TabsTrigger>
          <TabsTrigger value="webhook">Webhook VNDA</TabsTrigger>
          <TabsTrigger value="carts">Carrinhos ({carts.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="journey" className="space-y-4">
          {workspaceId ? (
            <CartRecoveryJourneyWorkflow workspaceId={workspaceId} />
          ) : (
            <Card>
              <CardContent className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
                Selecione um workspace para visualizar as jornadas.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ============================================ */}
        {/* RÉGUA */}
        {/* ============================================ */}
        <TabsContent value="rule" className="space-y-4">
          {/* Configuração geral compacta */}
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-[1fr_auto] gap-4 items-end">
                <div>
                  <Label className="text-xs">Expirar carrinhos após (horas)</Label>
                  <Input
                    type="number"
                    min={1}
                    className="max-w-[140px] mt-1"
                    value={rule.expire_after_hours}
                    onChange={(e) =>
                      setRule((r) => ({
                        ...r,
                        expire_after_hours: Number(e.target.value) || 168,
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Carrinhos sem compra após esse tempo são marcados como expirados.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card WhatsApp Template UTILITY */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-purple-600" />
                Template UTILITY pra WhatsApp
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {linkedTemplate ? (
                <>
                  <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="font-mono text-xs">
                        {linkedTemplate.name}
                      </Badge>
                      <Badge
                        variant={
                          linkedTemplate.status === "APPROVED"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {linkedTemplate.status}
                      </Badge>
                      <Badge variant="outline">{linkedTemplate.category}</Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={refreshTemplateStatus}
                        disabled={refreshingTemplate}
                        title="Consultar Meta e atualizar status"
                      >
                        {refreshingTemplate ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3 mr-1" />
                        )}
                        Atualizar status
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={createUtilityTemplate}
                        disabled={creatingTemplate}
                      >
                        {creatingTemplate ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3 mr-1" />
                        )}
                        Criar novo
                      </Button>
                    </div>
                  </div>
                  {linkedTemplate.status !== "APPROVED" && (
                    <p className="text-xs text-amber-700 flex items-start gap-1.5 mt-2">
                      <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                      Template ainda não foi aprovado pela Meta. A régua não
                      vai disparar WhatsApp até o status virar APPROVED.
                      Aprovação costuma sair em minutos — clica em{" "}
                      <strong>Atualizar status</strong> pra checar.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Eu crio pra você um template UTILITY na Meta (body só com
                    placeholders, sem texto comercial) e linko a todos os
                    steps automaticamente. UTILITY custa ~10x menos que
                    MARKETING.
                  </p>
                  <Button
                    size="sm"
                    onClick={createUtilityTemplate}
                    disabled={creatingTemplate}
                  >
                    {creatingTemplate ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    Criar template UTILITY automaticamente
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Steps */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Steps</h2>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={applyRecommended}
                disabled={applyingRecommended}
              >
                {applyingRecommended ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Usar régua recomendada
              </Button>
              <Button variant="outline" size="sm" onClick={addStep}>
                <Plus className="h-4 w-4 mr-2" /> Adicionar step
              </Button>
            </div>
          </div>

          {steps.length === 0 && (
            <Card>
              <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                Nenhum step configurado. Clique em &quot;Usar régua recomendada&quot;
                pra começar com 3 steps prontos.
              </CardContent>
            </Card>
          )}

          {/* Lista compacta de steps */}
          <div className="space-y-2">
            {steps.map((step, idx) => (
              <StepCard
                key={idx}
                step={step}
                templates={templates}
                onEdit={() => setEditingIdx(idx)}
                onRemove={() => removeStep(idx)}
              />
            ))}
          </div>
        </TabsContent>

        {/* ============================================ */}
        {/* WEBHOOK */}
        {/* ============================================ */}
        <TabsContent value="webhook">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Webhook className="h-4 w-4" />
                URL do webhook (cole no admin da VNDA)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {webhookUrl ? (
                <>
                  <div className="flex gap-2">
                    <Input
                      value={webhookUrl}
                      readOnly
                      className="font-mono text-xs"
                    />
                    <Button variant="outline" onClick={copyWebhook}>
                      {copied ? (
                        <>
                          <CheckCircle2 className="h-4 w-4 mr-2" /> Copiado
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4 mr-2" /> Copiar
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Configure essa URL no painel da VNDA como webhook de
                    carrinho abandonado. Usamos o mesmo token da integração
                    VNDA já configurada.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Conexão VNDA ainda não tem token configurado. Vá em /crm/vnda
                  para configurar a integração antes.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================ */}
        {/* CARRINHOS */}
        {/* ============================================ */}
        <TabsContent value="carts" className="space-y-4">
          {/* Import retroativo da VNDA */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Download className="h-4 w-4" />
                Importar carrinhos da VNDA
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Puxa os carrinhos abandonados das últimas N horas direto
                da API VNDA e injeta na régua. Útil pra começar com
                carrinhos retroativos (sem precisar esperar webhooks novos).
                Carrinhos já cadastrados não são duplicados.
              </p>
              <div className="flex items-end gap-2">
                <div>
                  <Label className="text-xs">Janela (horas)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={168}
                    className="w-32"
                    value={importHours}
                    onChange={(e) =>
                      setImportHours(
                        Math.max(
                          1,
                          Math.min(168, Number(e.target.value) || 48)
                        )
                      )
                    }
                  />
                </div>
                <Button
                  onClick={importFromVnda}
                  disabled={importingFromVnda}
                >
                  {importingFromVnda ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Importar
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Máx 168h (7 dias). Carrinhos sem email não podem ser
                importados (sem canal de contato).
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="p-3">Cliente</th>
                    <th className="p-3">Itens</th>
                    <th className="p-3">Valor</th>
                    <th className="p-3">Progresso</th>
                    <th className="p-3">Abandonado em</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {carts.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="p-6 text-center text-muted-foreground"
                      >
                        Nenhum carrinho ainda. Aguardando webhooks da VNDA.
                      </td>
                    </tr>
                  )}
                  {carts.map((c) => {
                    const pct =
                      c.steps_total > 0
                        ? Math.round((c.steps_sent / c.steps_total) * 100)
                        : 0;
                    return (
                      <tr
                        key={c.id}
                        className="border-b cursor-pointer hover:bg-muted/30 transition-colors"
                        onClick={() => openCartDetail(c.id)}
                      >
                        <td className="p-3">
                          <div className="font-medium">
                            {c.customer_name || "—"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {c.customer_email}
                          </div>
                        </td>
                        <td className="p-3 text-xs">
                          {Array.isArray(c.items) ? c.items.length : 0} item(s)
                          {c.items && c.items[0]?.name && (
                            <div className="text-muted-foreground">
                              {c.items[0].name}
                              {c.items.length > 1
                                ? ` +${c.items.length - 1}`
                                : ""}
                            </div>
                          )}
                        </td>
                        <td className="p-3">
                          {c.cart_total != null
                            ? BRL.format(c.cart_total)
                            : "—"}
                        </td>
                        <td className="p-3 min-w-[140px]">
                          <div className="flex items-center gap-2">
                            <Progress value={pct} className="h-2 flex-1" />
                            <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                              {c.steps_sent}/{c.steps_total}
                            </span>
                          </div>
                        </td>
                        <td className="p-3 text-xs">
                          {new Date(c.abandoned_at).toLocaleString("pt-BR")}
                        </td>
                        <td className="p-3">
                          <StatusBadge status={c.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ============================================ */}
      {/* SHEET DE DETALHE DO CARRINHO */}
      {/* ============================================ */}
      <Sheet
        open={cartDetail !== null || loadingCartDetail}
        onOpenChange={(open) => {
          if (!open) {
            setCartDetail(null);
            setLoadingCartDetail(false);
          }
        }}
      >
        <SheetContent
          side="right"
          className="!max-w-2xl sm:!max-w-2xl w-full overflow-y-auto"
        >
          {loadingCartDetail && !cartDetail ? (
            <div className="flex items-center justify-center min-h-[200px]">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : cartDetail ? (
            <CartDetailView detail={cartDetail} />
          ) : null}
        </SheetContent>
      </Sheet>

      {/* ============================================ */}
      {/* SHEET DE EDIÇÃO DE STEP */}
      {/* ============================================ */}
      <Sheet
        open={editingIdx !== null}
        onOpenChange={(open) => !open && setEditingIdx(null)}
      >
        <SheetContent
          side="right"
          className="!max-w-4xl sm:!max-w-4xl w-full overflow-y-auto"
        >
          {editingIdx !== null && steps[editingIdx] && (
            <StepEditor
              step={steps[editingIdx]}
              templates={templates}
              onChange={(patch) => updateStep(editingIdx, patch)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ============================================================
// KpisSection — KPIs + insights (etapa que converte / cupom)
// ============================================================
function KpisSection({
  kpis,
  fallbackSummary,
  onDiagnose,
  diagnosing,
}: {
  kpis: KpisResponse | null;
  fallbackSummary: Record<string, number>;
  onDiagnose: () => void;
  diagnosing: boolean;
}) {
  // Fallback usa o summary antigo quando KPIs ainda não chegaram
  // (loading inicial ou erro no endpoint).
  if (!kpis) {
    return (
      <div className="grid grid-cols-4 gap-3">
        <SummaryCard label="Abertos" value={fallbackSummary.open || 0} />
        <SummaryCard
          label="Recuperados"
          value={fallbackSummary.recovered || 0}
          icon={<CheckCircle2 className="h-3 w-3" />}
          tone="text-success"
        />
        <SummaryCard
          label="Expirados"
          value={fallbackSummary.expired || 0}
          icon={<Clock className="h-3 w-3" />}
          tone="text-warning"
        />
        <SummaryCard
          label="Fechados"
          value={fallbackSummary.closed || 0}
          icon={<XCircle className="h-3 w-3" />}
        />
      </div>
    );
  }

  const { totals, by_step, coupon_breakdown, conversion_pct } = kpis;

  const conversionLabel = `${conversion_pct.toFixed(1)}%`;
  const recoveredValue = totals.recovered.value;
  const openValue = totals.open.value;

  // Best-performing step pra destacar no badge.
  const topStep =
    by_step.length > 0
      ? by_step.reduce((max, s) => (s.value > max.value ? s : max), by_step[0])
      : null;

  return (
    <div className="space-y-4">
      {/* KPIs principais — 4 cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Abertos"
          primary={String(totals.open.count)}
          secondary={BRL.format(openValue)}
          hint="em andamento na régua"
          action={
            <Button
              size="sm"
              variant="ghost"
              onClick={onDiagnose}
              disabled={diagnosing}
              className="h-6 px-2 text-[10px]"
              title="Investigar duplicação"
            >
              {diagnosing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                "🔍 Diagnosticar"
              )}
            </Button>
          }
        />
        <KpiCard
          label="Recuperados"
          primary={BRL.format(recoveredValue)}
          secondary={`${totals.recovered.count} carrinho(s)`}
          tone="text-success"
          icon={<CheckCircle2 className="h-3 w-3" />}
        />
        <KpiCard
          label="Conversão"
          primary={conversionLabel}
          secondary={`${totals.recovered.count}/${kpis.total_carts}`}
          hint="recuperados / total"
        />
        <KpiCard
          label="Expirados"
          primary={String(totals.expired.count)}
          secondary={BRL.format(totals.expired.value)}
          tone="text-warning"
          icon={<Clock className="h-3 w-3" />}
          hint="perderam a janela"
        />
      </div>

      {/* Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Conversão por etapa */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              Conversão por etapa
              {topStep && topStep.step_order > 0 && (
                <Badge variant="secondary" className="font-normal">
                  Step {topStep.step_order} converte mais
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {by_step.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                Nenhuma recuperação ainda.
              </p>
            ) : (
              <StepConversionBars data={by_step} />
            )}
          </CardContent>
        </Card>

        {/* Cupom */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Gift className="h-4 w-4 text-purple-600" />
              Cupom no Step 3
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CouponBreakdownBars data={coupon_breakdown} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================
// KpiCard — card de KPI principal
// ============================================================
function KpiCard({
  label,
  primary,
  secondary,
  icon,
  tone,
  hint,
  action,
}: {
  label: string;
  primary: string;
  secondary?: string;
  icon?: React.ReactNode;
  tone?: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            {icon}
            {label}
          </div>
          {action}
        </div>
        <div className={`text-2xl font-bold mt-1 ${tone || ""}`}>{primary}</div>
        {secondary && (
          <div className="text-xs text-muted-foreground mt-0.5">
            {secondary}
          </div>
        )}
        {hint && !secondary && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {hint}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// StepConversionBars — barras horizontais por step
// ============================================================
function StepConversionBars({
  data,
}: {
  data: Array<{ step_order: number; count: number; value: number }>;
}) {
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const totalCount = data.reduce((sum, d) => sum + d.count, 0);
  return (
    <div className="space-y-2">
      {data.map((d) => {
        const pct = (d.value / maxValue) * 100;
        const sharePct =
          totalCount > 0 ? Math.round((d.count / totalCount) * 100) : 0;
        const label =
          d.step_order === 0 ? "Sem mensagem (orgânico)" : `Step ${d.step_order}`;
        return (
          <div key={d.step_order} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{label}</span>
              <span className="text-muted-foreground tabular-nums">
                {BRL.format(d.value)} · {d.count} ({sharePct}%)
              </span>
            </div>
            <div className="h-2 bg-muted rounded overflow-hidden">
              <div
                className="h-full bg-emerald-600 rounded"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// CouponBreakdownBars — usado / não usou / sem cupom
// ============================================================
function CouponBreakdownBars({
  data,
}: {
  data: {
    coupon_sent_used: { count: number; value: number };
    coupon_sent_unused: { count: number; value: number };
    no_coupon_sent: { count: number; value: number };
  };
}) {
  const totalCount =
    data.coupon_sent_used.count +
    data.coupon_sent_unused.count +
    data.no_coupon_sent.count;

  if (totalCount === 0) {
    return (
      <p className="text-xs italic text-muted-foreground">
        Nenhuma recuperação ainda.
      </p>
    );
  }

  const rows = [
    {
      label: "Cupom usado no checkout",
      hint: "step 3 chegou e cliente aplicou o código",
      ...data.coupon_sent_used,
      color: "bg-purple-600",
    },
    {
      label: "Cupom enviado mas não usado",
      hint: "step 3 chegou mas cliente comprou sem aplicar",
      ...data.coupon_sent_unused,
      color: "bg-purple-300",
    },
    {
      label: "Sem cupom enviado",
      hint: "recuperou antes do step 3 (sem precisar de desconto)",
      ...data.no_coupon_sent,
      color: "bg-emerald-500",
    },
  ];

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const sharePct =
          totalCount > 0 ? Math.round((r.count / totalCount) * 100) : 0;
        return (
          <div key={r.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{r.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {BRL.format(r.value)} · {r.count} ({sharePct}%)
              </span>
            </div>
            <div className="h-2 bg-muted rounded overflow-hidden">
              <div
                className={`h-full ${r.color} rounded`}
                style={{ width: `${sharePct}%` }}
              />
            </div>
            <div className="text-[10px] text-muted-foreground">{r.hint}</div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// SummaryCard — fallback usado enquanto KPIs não carregam
// ============================================================
function SummaryCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          {icon}
          {label}
        </div>
        <div className={`text-2xl font-bold mt-1 ${tone || ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// StatusBadge
// ============================================================
function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
  > = {
    open: { label: "Aberto", variant: "default" },
    recovered: { label: "Recuperado", variant: "secondary" },
    expired: { label: "Expirado", variant: "outline" },
    closed: { label: "Fechado", variant: "outline" },
  };
  const info = map[status] || { label: status, variant: "outline" as const };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}

// ============================================================
// StepCard — cartão compacto na lista, 1 linha + sumário
// ============================================================
function StepCard({
  step,
  templates,
  onEdit,
  onRemove,
}: {
  step: Step;
  templates: WaTemplate[];
  onEdit: () => void;
  onRemove: () => void;
}) {
  const hasLink = stepHasCartUrl(step);
  const template = templates.find((t) => t.id === step.whatsapp_template_id);

  // Resumo dos canais
  const channels: string[] = [];
  if (step.whatsapp_enabled) {
    channels.push(
      template
        ? `WhatsApp · ${template.name}${
            template.status !== "APPROVED" ? ` (${template.status})` : ""
          }`
        : "WhatsApp (sem template)"
    );
  }
  if (step.email_enabled) {
    channels.push("Email");
  }
  const hasCoupon = (step.coupon_pct || 0) > 0;

  return (
    <Card
      className="cursor-pointer hover:bg-muted/30 transition-colors"
      onClick={onEdit}
    >
      <CardContent className="py-4 flex items-center gap-4">
        <Badge variant="outline" className="shrink-0">
          Step {step.step_order}
        </Badge>
        <div className="text-sm font-medium shrink-0 w-20">
          {formatDelay(step.delay_minutes)}
        </div>
        <div className="flex-1 flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
          {channels.length === 0 ? (
            <span className="italic">Nenhum canal ativo</span>
          ) : (
            channels.map((c, i) => (
              <Badge key={i} variant="secondary" className="font-normal">
                {c.startsWith("WhatsApp") ? (
                  <MessageCircle className="h-3 w-3 mr-1 text-emerald-600" />
                ) : (
                  <Mail className="h-3 w-3 mr-1 text-blue-600" />
                )}
                {c}
              </Badge>
            ))
          )}
          {hasCoupon && (
            <Badge
              variant="outline"
              className="border-purple-300 bg-purple-50 text-purple-900 font-normal"
            >
              <Gift className="h-3 w-3 mr-1" />
              {step.coupon_pct}% off · {step.coupon_validity_hours}h
            </Badge>
          )}
        </div>
        {(step.whatsapp_enabled || step.email_enabled) && !hasLink && (
          <Badge
            variant="outline"
            className="border-amber-300 bg-amber-50 text-amber-900"
          >
            <AlertCircle className="h-3 w-3 mr-1" />
            sem link
          </Badge>
        )}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Pencil className="h-3 w-3 mr-1" />
            Editar
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// CartDetailView — conteúdo do Sheet de detalhe do carrinho
// ============================================================
function CartDetailView({ detail }: { detail: CartDetailResponse }) {
  const { cart, steps, messages } = detail;
  const items = Array.isArray(cart.items) ? cart.items : [];
  const startTime = cart.recovery_started_at || cart.abandoned_at;
  const now = Date.now();
  const [expandedMessageKey, setExpandedMessageKey] = useState<string | null>(
    null
  );

  // Agrupa messages por step_id pra timeline.
  const messagesByStep = new Map<string, DetailMessage[]>();
  for (const m of messages) {
    if (!messagesByStep.has(m.step_id))
      messagesByStep.set(m.step_id, []);
    messagesByStep.get(m.step_id)!.push(m);
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2 flex-wrap">
          <ShoppingCart className="h-5 w-5" />
          {cart.customer_name || cart.customer_email}
          <StatusBadge status={cart.status} />
        </SheetTitle>
        <SheetDescription>
          Abandonado em {new Date(cart.abandoned_at).toLocaleString("pt-BR")}
          {cart.recovery_started_at &&
            cart.recovery_started_at !== cart.abandoned_at && (
              <>
                {" · "}
                Régua iniciada em{" "}
                {new Date(cart.recovery_started_at).toLocaleString("pt-BR")}
              </>
            )}
        </SheetDescription>
      </SheetHeader>

      {/* Resumo do cliente */}
      <Card className="mt-4">
        <CardContent className="pt-6 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">
              {cart.customer_name || (
                <span className="italic text-muted-foreground">
                  Nome não disponível
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Mail className="h-4 w-4" />
            {cart.customer_email}
          </div>
          {cart.customer_phone && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-4 w-4" />
              {cart.customer_phone}
            </div>
          )}
          {cart.vnda_client_id && (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Hash className="h-3 w-3" />
              VNDA client_id: {cart.vnda_client_id}
            </div>
          )}
          {cart.recovery_url && (
            <a
              href={cart.recovery_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-1"
            >
              <ExternalLink className="h-3 w-3" />
              Abrir carrinho na loja
            </a>
          )}
        </CardContent>
      </Card>

      {/* Items */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            {items.length} item(s) · {cart.cart_total != null ? BRL.format(cart.cart_total) : "—"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.length === 0 && (
            <p className="text-xs italic text-muted-foreground">
              Sem detalhes de items (cart importado da listagem VNDA, que não
              traz items granular).
            </p>
          )}
          {items.map((it, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border rounded-md p-2"
            >
              {it.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={it.image_url}
                  alt={it.name || ""}
                  className="w-12 h-12 object-cover rounded"
                />
              ) : (
                <div className="w-12 h-12 bg-muted rounded flex items-center justify-center">
                  <Package className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {it.name || "—"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {it.sku ? `SKU ${it.sku}` : ""} · qty {it.quantity}
                  {it.price != null ? ` · ${BRL.format(it.price)}` : ""}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Cupom de recuperação (se gerado) */}
      {cart.coupon_code && (
        <Card className="mt-4 border-purple-200 bg-purple-50/50">
          <CardContent className="pt-6 flex items-center gap-3">
            <Gift className="h-5 w-5 text-purple-700" />
            <div className="flex-1">
              <div className="font-mono text-sm font-medium">
                {cart.coupon_code}
              </div>
              {cart.recovery_coupon_expires_at && (
                <div className="text-xs text-muted-foreground">
                  Expira em{" "}
                  {new Date(
                    cart.recovery_coupon_expires_at
                  ).toLocaleString("pt-BR")}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Timeline dos steps */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Progresso da régua</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {steps.length === 0 && (
            <p className="text-xs italic text-muted-foreground">
              Régua sem steps configurados.
            </p>
          )}
          {steps.map((step) => {
            const stepMessages = messagesByStep.get(step.id) || [];
            const fireAt =
              new Date(startTime).getTime() + step.delay_minutes * 60 * 1000;
            const isDue = fireAt <= now;
            const minutesUntil = Math.round((fireAt - now) / 60000);
            const channels: string[] = [];
            if (step.whatsapp_enabled) channels.push("WhatsApp");
            if (step.email_enabled) channels.push("Email");

            return (
              <div
                key={step.id}
                className="border rounded-md p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Step {step.step_order}</Badge>
                    <span className="text-sm">
                      {formatDelay(step.delay_minutes)} após início
                    </span>
                    {step.coupon_pct > 0 && (
                      <Badge
                        variant="outline"
                        className="border-purple-300 bg-purple-50 text-purple-900 text-[10px]"
                      >
                        <Gift className="h-2.5 w-2.5 mr-1" />
                        {step.coupon_pct}% off
                      </Badge>
                    )}
                  </div>
                  {!isDue && stepMessages.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      em {minutesUntil < 60
                        ? `${minutesUntil}min`
                        : minutesUntil < 1440
                        ? `${Math.round(minutesUntil / 60)}h`
                        : `${Math.round(minutesUntil / 1440)}d`}
                    </span>
                  )}
                </div>

                {/* Canais */}
                <div className="space-y-1">
                  {channels.length === 0 && (
                    <span className="text-xs italic text-muted-foreground">
                      Nenhum canal ativo nesse step
                    </span>
                  )}
                  {channels.map((channel) => {
                    const channelKey =
                      channel === "WhatsApp" ? "whatsapp" : "email";
                    const msg = stepMessages.find(
                      (m) => m.channel === channelKey
                    );
                    const messageKey = `${step.id}:${channelKey}`;
                    const isExpanded = expandedMessageKey === messageKey;
                    const canExpand =
                      msg?.status === "sent" && msg.rendered_payload;
                    return (
                      <div key={channel} className="space-y-1">
                        <button
                          type="button"
                          disabled={!canExpand}
                          onClick={() =>
                            setExpandedMessageKey(
                              isExpanded ? null : messageKey
                            )
                          }
                          className={`flex items-center gap-2 text-xs w-full text-left ${
                            canExpand
                              ? "cursor-pointer hover:bg-muted/40 rounded -mx-1 px-1 py-0.5"
                              : ""
                          }`}
                        >
                          {channel === "WhatsApp" ? (
                            <MessageCircle className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <Mail className="h-3 w-3 text-blue-600" />
                          )}
                          <span className="font-medium">{channel}</span>
                          {msg ? (
                            msg.status === "sent" ? (
                              <>
                                <span className="text-emerald-700 flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  enviado{" "}
                                  {new Date(msg.sent_at).toLocaleString(
                                    "pt-BR"
                                  )}
                                </span>
                                {canExpand && (
                                  <span className="ml-auto text-[10px] text-muted-foreground">
                                    {isExpanded ? "ocultar" : "ver mensagem"}
                                  </span>
                                )}
                              </>
                            ) : msg.status === "failed" ? (
                              <span className="text-red-700 flex items-center gap-1">
                                <XCircle className="h-3 w-3" />
                                falhou
                                {msg.error ? `: ${msg.error}` : ""}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                {msg.status}
                              </span>
                            )
                          ) : isDue ? (
                            <span className="text-amber-700 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              agendado
                            </span>
                          ) : (
                            <span className="text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              pendente
                            </span>
                          )}
                        </button>

                        {/* Conteúdo expandido — mensagem real que o cliente recebeu */}
                        {isExpanded && msg?.rendered_payload && (
                          <RenderedMessagePreview
                            channel={channelKey}
                            payload={msg.rendered_payload}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </>
  );
}

// ============================================================
// RenderedMessagePreview — mostra o conteúdo real que foi enviado
// ============================================================
function RenderedMessagePreview({
  channel,
  payload,
}: {
  channel: "whatsapp" | "email";
  payload: NonNullable<DetailMessage["rendered_payload"]>;
}) {
  if (channel === "whatsapp") {
    return (
      <div className="ml-5 space-y-1">
        {payload.phone && (
          <div className="text-[10px] text-muted-foreground">
            Pra {payload.phone}
            {payload.template_name && (
              <>
                {" · template "}
                <code className="font-mono">{payload.template_name}</code>
              </>
            )}
          </div>
        )}
        <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 text-sm whitespace-pre-wrap font-sans">
          {payload.body || (
            <span className="italic text-muted-foreground">
              (sem body renderizado)
            </span>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="ml-5 space-y-1">
      {payload.to && (
        <div className="text-[10px] text-muted-foreground">Pra {payload.to}</div>
      )}
      <div className="bg-blue-50 border border-blue-200 rounded-md overflow-hidden">
        <div className="p-3 border-b border-blue-200">
          <div className="text-[10px] uppercase text-muted-foreground">
            Assunto
          </div>
          <div className="text-sm font-medium mt-0.5">
            {payload.subject || (
              <span className="italic text-muted-foreground">(vazio)</span>
            )}
          </div>
        </div>
        <div
          className="bg-white max-h-[400px] overflow-auto text-sm"
          dangerouslySetInnerHTML={{
            __html:
              payload.body_html ||
              `<div class="p-4 text-muted-foreground italic">(corpo vazio)</div>`,
          }}
        />
      </div>
    </div>
  );
}

// ============================================================
// StepEditor — conteúdo do Sheet, 2 colunas (edição | preview)
// ============================================================
function StepEditor({
  step,
  templates,
  onChange,
}: {
  step: Step;
  templates: WaTemplate[];
  onChange: (patch: Partial<Step>) => void;
}) {
  const template = templates.find((t) => t.id === step.whatsapp_template_id);
  const tplPositions = extractTemplateVars(template);
  const hasLink = stepHasCartUrl(step);

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <Badge variant="outline">Step {step.step_order}</Badge>
          Editar
        </SheetTitle>
        <SheetDescription>
          Dispara {formatDelay(step.delay_minutes)} após o abandono. Mudanças
          só ficam salvas após clicar em &quot;Salvar&quot;.
        </SheetDescription>
      </SheetHeader>

      {(step.whatsapp_enabled || step.email_enabled) && !hasLink && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>
            <strong>Sem link de retomada.</strong> No WhatsApp, mapeie uma
            variável como <code>recovery_url</code> (ou use texto com{" "}
            <code>{"{{recovery_url}}"}</code>). No Email, inclua{" "}
            <code>{"{{recovery_url}}"}</code> no assunto ou body.
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        {/* ============ COLUNA ESQUERDA: edição ============ */}
        <div className="space-y-5">
          <div>
            <Label className="text-xs">Atraso (minutos)</Label>
            <Input
              type="number"
              min={0}
              className="mt-1"
              value={step.delay_minutes}
              onChange={(e) =>
                onChange({ delay_minutes: Number(e.target.value) || 0 })
              }
            />
          </div>

          {/* Cupom automático */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-purple-600" />
                Cupom automático
              </Label>
              <Switch
                checked={(step.coupon_pct || 0) > 0}
                onCheckedChange={(v) =>
                  onChange({ coupon_pct: v ? 10 : 0 })
                }
              />
            </div>
            {(step.coupon_pct || 0) > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Desconto (%)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={step.coupon_pct}
                      onChange={(e) =>
                        onChange({
                          coupon_pct: Math.max(
                            0,
                            Math.min(100, Number(e.target.value) || 0)
                          ),
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Validade (horas)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={step.coupon_validity_hours}
                      onChange={(e) =>
                        onChange({
                          coupon_validity_hours: Math.max(
                            1,
                            Number(e.target.value) || 48
                          ),
                        })
                      }
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Um cupom único por carrinho é criado na VNDA antes do
                  dispatch. Use <code>{"{{coupon_code}}"}</code> no
                  WhatsApp/Email pra inserir o código (formato:{" "}
                  <code>BKNG{step.coupon_pct}_XXXXXX</code>).
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Step não gera cupom. Ative pra criar cupom único por
                carrinho (X% off, válido por Y horas) automaticamente antes
                do envio.
              </p>
            )}
          </div>

          {/* WhatsApp */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-emerald-600" />
                WhatsApp
              </Label>
              <Switch
                checked={step.whatsapp_enabled}
                onCheckedChange={(v) => onChange({ whatsapp_enabled: v })}
              />
            </div>
            {step.whatsapp_enabled && (
              <>
                <div>
                  <Label className="text-xs">Template aprovado</Label>
                  <Select
                    value={step.whatsapp_template_id || ""}
                    onValueChange={(v) =>
                      onChange({
                        whatsapp_template_id: v,
                        whatsapp_variable_mapping: {},
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates
                        .filter((t) => t.status === "APPROVED")
                        .map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name} ({t.category})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {tplPositions.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs">Variáveis do template</Label>
                    {tplPositions.map((pos) => {
                      const raw = step.whatsapp_variable_mapping[pos] || "";
                      const parsed = parseMappingValue(raw);
                      return (
                        <div
                          key={pos}
                          className="grid grid-cols-[40px_110px_1fr] gap-2 items-start"
                        >
                          <Badge variant="secondary" className="mt-1.5">
                            {"{{"}
                            {pos}
                            {"}}"}
                          </Badge>
                          <Select
                            value={parsed.kind}
                            onValueChange={(kind) =>
                              onChange({
                                whatsapp_variable_mapping: {
                                  ...step.whatsapp_variable_mapping,
                                  [pos]: encodeMappingValue(
                                    kind as "var" | "text",
                                    ""
                                  ),
                                },
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="var">Variável</SelectItem>
                              <SelectItem value="text">Texto livre</SelectItem>
                            </SelectContent>
                          </Select>
                          {parsed.kind === "var" ? (
                            <Select
                              value={parsed.value}
                              onValueChange={(v) =>
                                onChange({
                                  whatsapp_variable_mapping: {
                                    ...step.whatsapp_variable_mapping,
                                    [pos]: encodeMappingValue("var", v),
                                  },
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione a variável" />
                              </SelectTrigger>
                              <SelectContent>
                                {AVAILABLE_VARS.map((v) => (
                                  <SelectItem key={v} value={v}>
                                    {v}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Textarea
                              value={parsed.value}
                              rows={3}
                              onChange={(e) =>
                                onChange({
                                  whatsapp_variable_mapping: {
                                    ...step.whatsapp_variable_mapping,
                                    [pos]: encodeMappingValue(
                                      "text",
                                      e.target.value
                                    ),
                                  },
                                })
                              }
                              placeholder="Texto livre. Suporta {{customer_first_name}}, {{recovery_url}}, etc."
                              className="text-xs"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Email */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-blue-600" />
                Email
              </Label>
              <Switch
                checked={step.email_enabled}
                onCheckedChange={(v) => onChange({ email_enabled: v })}
              />
            </div>
            {step.email_enabled && (
              <>
                <div>
                  <Label className="text-xs">Assunto</Label>
                  <Input
                    value={step.email_subject || ""}
                    onChange={(e) => onChange({ email_subject: e.target.value })}
                    placeholder="Ex: {{customer_first_name}}, esqueceu algo no carrinho?"
                  />
                </div>
                <div>
                  <Label className="text-xs">Corpo (HTML)</Label>
                  <Textarea
                    rows={10}
                    className="font-mono text-xs"
                    value={step.email_body_html || ""}
                    onChange={(e) =>
                      onChange({ email_body_html: e.target.value })
                    }
                    placeholder={`<p>Oi {{customer_first_name}}!</p>\n<p>Vi que você deixou {{first_item_name}} no carrinho.</p>\n<p><a href="{{recovery_url}}">Voltar pro carrinho</a></p>`}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Variáveis disponíveis em ambos os campos:{" "}
                    {AVAILABLE_VARS.map((v) => `{{${v}}}`).join(", ")}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ============ COLUNA DIREITA: previews ============ */}
        <div className="space-y-5 lg:sticky lg:top-0 lg:self-start">
          <Label className="text-xs flex items-center gap-1 text-muted-foreground">
            <Eye className="h-3 w-3" /> Pré-visualização (dados de exemplo:{" "}
            {SAMPLE_VARS.customer_first_name}, {SAMPLE_VARS.cart_total_formatted})
          </Label>

          {/* Preview WhatsApp */}
          {step.whatsapp_enabled && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-2 flex items-center gap-1">
                <MessageCircle className="h-3 w-3 text-emerald-600" /> WhatsApp
              </div>
              {template && getTemplateBody(template) ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm whitespace-pre-wrap font-sans">
                  {previewWhatsAppBody(
                    getTemplateBody(template),
                    step.whatsapp_variable_mapping,
                    SAMPLE_VARS
                  )}
                </div>
              ) : (
                <div className="text-xs italic text-muted-foreground border border-dashed rounded-lg p-4 text-center">
                  Selecione um template aprovado pra ver o preview
                </div>
              )}
            </div>
          )}

          {/* Preview Email */}
          {step.email_enabled && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-2 flex items-center gap-1">
                <Mail className="h-3 w-3 text-blue-600" /> Email
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg overflow-hidden">
                <div className="p-3 border-b border-blue-200">
                  <div className="text-[10px] uppercase text-muted-foreground">
                    Assunto
                  </div>
                  <div className="text-sm font-medium mt-0.5">
                    {interpolate(step.email_subject || "", SAMPLE_VARS) || (
                      <span className="italic text-muted-foreground">
                        (vazio)
                      </span>
                    )}
                  </div>
                </div>
                <div
                  className="bg-white max-h-[500px] overflow-auto text-sm"
                  dangerouslySetInnerHTML={{
                    __html: interpolate(
                      step.email_body_html || "",
                      SAMPLE_VARS
                    ) || `<div class="p-4 text-muted-foreground italic">(corpo vazio)</div>`,
                  }}
                />
              </div>
            </div>
          )}

          {!step.whatsapp_enabled && !step.email_enabled && (
            <div className="text-xs italic text-muted-foreground border border-dashed rounded-lg p-6 text-center">
              Ative WhatsApp ou Email pra ver o preview
            </div>
          )}
        </div>
      </div>
    </>
  );
}
