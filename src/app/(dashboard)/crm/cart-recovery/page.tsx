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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";
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
  Info,
  Eye,
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
  "cart_total",
  "cart_total_formatted",
  "first_item_name",
  "items_count",
  "recovery_url",
  "coupon_code",
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
  cart_total: number | null;
  status: string;
  abandoned_at: string;
  recovered_at: string | null;
  recovery_url: string | null;
  items: Array<{ name: string | null }> | null;
}

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function emptyStep(order: number): Step {
  return {
    step_order: order,
    delay_minutes: order === 1 ? 60 : order === 2 ? 1440 : 4320,
    whatsapp_enabled: false,
    whatsapp_template_id: null,
    whatsapp_variable_mapping: {},
    email_enabled: false,
    email_subject: null,
    email_body_html: null,
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

export default function CartRecoveryPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  const fetchAll = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const headers = { "x-workspace-id": workspaceId };
      const [ruleRes, tplRes, cartsRes] = await Promise.all([
        fetch("/api/crm/cart-recovery/rule", { headers }),
        fetch("/api/crm/whatsapp/templates", { headers }),
        fetch("/api/crm/cart-recovery/carts?limit=50", { headers }),
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
      setTemplates(
        (tplData.templates || []).filter(
          (t: WaTemplate) => t.status === "APPROVED"
        )
      );

      const cartsData = await cartsRes.json();
      setCarts(cartsData.carts || []);
      setSummary(cartsData.summary || {});
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
    setSteps((prev) => [...prev, emptyStep(prev.length + 1)]);
  };

  const removeStep = (idx: number) => {
    setSteps((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, step_order: i + 1 }))
    );
  };

  const updateStep = (idx: number, patch: Partial<Step>) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s))
    );
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

      {/* Resumo */}
      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Abertos</div>
            <div className="text-2xl font-bold mt-1">
              {summary.open || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Recuperados
            </div>
            <div className="text-2xl font-bold mt-1 text-green-700">
              {summary.recovered || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Expirados
            </div>
            <div className="text-2xl font-bold mt-1 text-amber-700">
              {summary.expired || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <XCircle className="h-3 w-3" /> Fechados
            </div>
            <div className="text-2xl font-bold mt-1">
              {summary.closed || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="rule">
        <TabsList>
          <TabsTrigger value="rule">Régua</TabsTrigger>
          <TabsTrigger value="webhook">Webhook VNDA</TabsTrigger>
          <TabsTrigger value="carts">Carrinhos ({carts.length})</TabsTrigger>
        </TabsList>

        {/* ============================================ */}
        {/* Régua                                        */}
        {/* ============================================ */}
        <TabsContent value="rule" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Configuração geral</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Expirar carrinhos após (horas)</Label>
                  <Input
                    type="number"
                    min={1}
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

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Steps</h2>
            <Button variant="outline" size="sm" onClick={addStep}>
              <Plus className="h-4 w-4 mr-2" /> Adicionar step
            </Button>
          </div>

          {steps.length === 0 && (
            <Card>
              <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                Nenhum step configurado. Clique em &quot;Adicionar step&quot; pra começar.
              </CardContent>
            </Card>
          )}

          {steps.map((step, idx) => {
            const template = templates.find(
              (t) => t.id === step.whatsapp_template_id
            );
            const tplPositions = extractTemplateVars(template);
            return (
              <Card key={idx}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Badge variant="outline">Step {step.step_order}</Badge>
                    <span className="text-sm font-normal text-muted-foreground">
                      Dispara {formatDelay(step.delay_minutes)} após o abandono
                    </span>
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeStep(idx)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Atraso (minutos)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={step.delay_minutes}
                      onChange={(e) =>
                        updateStep(idx, {
                          delay_minutes: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>

                  {/* WhatsApp */}
                  <div className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="flex items-center gap-2">
                        <MessageCircle className="h-4 w-4 text-green-600" />
                        WhatsApp
                      </Label>
                      <Switch
                        checked={step.whatsapp_enabled}
                        onCheckedChange={(v) =>
                          updateStep(idx, { whatsapp_enabled: v })
                        }
                      />
                    </div>
                    {step.whatsapp_enabled && (
                      <>
                        <div>
                          <Label className="text-xs">Template aprovado</Label>
                          <Select
                            value={step.whatsapp_template_id || ""}
                            onValueChange={(v) =>
                              updateStep(idx, {
                                whatsapp_template_id: v,
                                whatsapp_variable_mapping: {},
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione um template" />
                            </SelectTrigger>
                            <SelectContent>
                              {templates.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.name} ({t.language})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {templates.length === 0 && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              <Info className="h-3 w-3" />
                              Nenhum template aprovado. Configure em /crm/whatsapp.
                            </p>
                          )}
                        </div>

                        {tplPositions.length > 0 && (
                          <div className="space-y-2">
                            <Label className="text-xs">
                              Variáveis do template
                            </Label>
                            {tplPositions.map((pos) => {
                              const raw =
                                step.whatsapp_variable_mapping[pos] || "";
                              const parsed = parseMappingValue(raw);
                              return (
                                <div
                                  key={pos}
                                  className="grid grid-cols-[60px_140px_1fr] gap-2 items-center"
                                >
                                  <Badge variant="secondary">
                                    {"{{"}
                                    {pos}
                                    {"}}"}
                                  </Badge>
                                  <Select
                                    value={parsed.kind}
                                    onValueChange={(kind) =>
                                      updateStep(idx, {
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
                                      <SelectItem value="var">
                                        Variável
                                      </SelectItem>
                                      <SelectItem value="text">
                                        Texto livre
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {parsed.kind === "var" ? (
                                    <Select
                                      value={parsed.value}
                                      onValueChange={(v) =>
                                        updateStep(idx, {
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
                                    <Input
                                      value={parsed.value}
                                      onChange={(e) =>
                                        updateStep(idx, {
                                          whatsapp_variable_mapping: {
                                            ...step.whatsapp_variable_mapping,
                                            [pos]: encodeMappingValue(
                                              "text",
                                              e.target.value
                                            ),
                                          },
                                        })
                                      }
                                      placeholder="Texto fixo (ex: 10% de desconto)"
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Preview do WhatsApp */}
                        {template && getTemplateBody(template) && (
                          <div className="space-y-2 pt-2 border-t">
                            <Label className="text-xs flex items-center gap-1 text-muted-foreground">
                              <Eye className="h-3 w-3" /> Pré-visualização
                            </Label>
                            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm whitespace-pre-wrap font-sans">
                              {previewWhatsAppBody(
                                getTemplateBody(template),
                                step.whatsapp_variable_mapping,
                                SAMPLE_VARS
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                              Usando dados de exemplo ({SAMPLE_VARS.customer_first_name}, {SAMPLE_VARS.cart_total_formatted}, etc).
                            </p>
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
                        onCheckedChange={(v) =>
                          updateStep(idx, { email_enabled: v })
                        }
                      />
                    </div>
                    {step.email_enabled && (
                      <>
                        <div>
                          <Label className="text-xs">Assunto</Label>
                          <Input
                            value={step.email_subject || ""}
                            onChange={(e) =>
                              updateStep(idx, { email_subject: e.target.value })
                            }
                            placeholder="Ex: {{customer_first_name}}, esqueceu algo no carrinho?"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">
                            Corpo (HTML, suporta {"{{var_name}}"})
                          </Label>
                          <Textarea
                            rows={8}
                            value={step.email_body_html || ""}
                            onChange={(e) =>
                              updateStep(idx, {
                                email_body_html: e.target.value,
                              })
                            }
                            placeholder={`<p>Oi {{customer_first_name}}!</p>\n<p>Vi que você deixou {{first_item_name}} no carrinho.</p>\n<p><a href="{{recovery_url}}">Voltar pro carrinho</a></p>`}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Variáveis: {AVAILABLE_VARS.map((v) => `{{${v}}}`).join(", ")}
                        </p>

                        {/* Preview do Email */}
                        {(step.email_subject || step.email_body_html) && (
                          <div className="space-y-2 pt-2 border-t">
                            <Label className="text-xs flex items-center gap-1 text-muted-foreground">
                              <Eye className="h-3 w-3" /> Pré-visualização
                            </Label>
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                              <div>
                                <div className="text-[10px] uppercase text-muted-foreground mb-1">
                                  Assunto
                                </div>
                                <div className="text-sm font-medium">
                                  {interpolate(
                                    step.email_subject || "",
                                    SAMPLE_VARS
                                  ) || (
                                    <span className="italic text-muted-foreground">
                                      (vazio)
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] uppercase text-muted-foreground mb-1">
                                  Corpo
                                </div>
                                <div
                                  className="text-sm bg-white border rounded p-2 max-h-64 overflow-auto"
                                  dangerouslySetInnerHTML={{
                                    __html: interpolate(
                                      step.email_body_html || "",
                                      SAMPLE_VARS
                                    ),
                                  }}
                                />
                              </div>
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                              Usando dados de exemplo. Variáveis disponíveis em ambos os campos.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* ============================================ */}
        {/* Webhook                                      */}
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
                    <Input value={webhookUrl} readOnly className="font-mono text-xs" />
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
                    Configure essa URL no painel da VNDA como webhook de carrinho abandonado.
                    Usamos o mesmo token da integração VNDA já configurada.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Conexão VNDA ainda não tem token configurado. Vá em /crm/vnda para
                  configurar a integração antes.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================ */}
        {/* Carrinhos                                    */}
        {/* ============================================ */}
        <TabsContent value="carts">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="p-3">Cliente</th>
                    <th className="p-3">Itens</th>
                    <th className="p-3">Valor</th>
                    <th className="p-3">Abandonado em</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {carts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-muted-foreground">
                        Nenhum carrinho ainda. Aguardando webhooks da VNDA.
                      </td>
                    </tr>
                  )}
                  {carts.map((c) => (
                    <tr key={c.id} className="border-b">
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
                            {c.items.length > 1 ? ` +${c.items.length - 1}` : ""}
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        {c.cart_total != null ? BRL.format(c.cart_total) : "—"}
                      </td>
                      <td className="p-3 text-xs">
                        {new Date(c.abandoned_at).toLocaleString("pt-BR")}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={c.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    open: { label: "Aberto", variant: "default" },
    recovered: { label: "Recuperado", variant: "secondary" },
    expired: { label: "Expirado", variant: "outline" },
    closed: { label: "Fechado", variant: "outline" },
  };
  const info = map[status] || { label: status, variant: "outline" as const };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}

function formatDelay(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}
