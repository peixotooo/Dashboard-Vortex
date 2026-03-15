"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/lib/workspace-context";
import {
  MessageCircle,
  RefreshCw,
  Send,
  Settings,
  FileText,
  Plus,
  CheckCircle2,
  Clock,
  AlertCircle,
  Eye,
  Loader2,
} from "lucide-react";

// --- Types ---

interface WaTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: Array<{
    type: string;
    text?: string;
    format?: string;
    buttons?: Array<{ type: string; text: string; url?: string }>;
  }>;
}

interface WaCampaign {
  id: string;
  name: string;
  status: string;
  total_messages: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  wa_templates: { name: string; language: string } | null;
}

interface RfmSegment {
  segment: string;
  count: number;
}

// --- RFM segment labels ---

const SEGMENT_LABELS: Record<string, string> = {
  champions: "Champions",
  loyal_customers: "Clientes Fieis",
  potential_loyalists: "Potenciais Fieis",
  recent_customers: "Clientes Recentes",
  promising: "Promissores",
  need_attention: "Precisam de Atencao",
  about_to_sleep: "Quase Dormindo",
  at_risk: "Em Risco",
  cant_lose: "Nao Pode Perder",
  hibernating: "Hibernando",
  lost: "Perdidos",
};

export default function WhatsAppPage() {
  const { workspace } = useWorkspace();
  const [activeTab, setActiveTab] = useState("campaigns");

  // Config state
  const [configLoading, setConfigLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [displayPhone, setDisplayPhone] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  // Templates state
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [syncingTemplates, setSyncingTemplates] = useState(false);

  // Campaigns state
  const [campaigns, setCampaigns] = useState<WaCampaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);

  // Campaign creation state
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState(1);
  const [campaignName, setCampaignName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<WaTemplate | null>(null);
  const [selectedSegment, setSelectedSegment] = useState("");
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [segments, setSegments] = useState<RfmSegment[]>([]);
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const wsHeaders = useCallback(() => {
    return {
      "x-workspace-id": workspace?.id || "",
      "Content-Type": "application/json",
    };
  }, [workspace?.id]);

  // --- Data fetching ---

  const fetchConfig = useCallback(async () => {
    if (!workspace?.id) return;
    setConfigLoading(true);
    try {
      const res = await fetch("/api/crm/whatsapp/config", { headers: wsHeaders() });
      const data = await res.json();
      setConfigured(data.configured || false);
      if (data.configured) {
        setPhoneNumberId(data.phoneNumberId || "");
        setWabaId(data.wabaId || "");
        setDisplayPhone(data.displayPhone || "");
      }
    } catch {
      // ignore
    }
    setConfigLoading(false);
  }, [workspace?.id, wsHeaders]);

  const fetchTemplates = useCallback(async () => {
    if (!workspace?.id) return;
    try {
      const res = await fetch("/api/crm/whatsapp/templates", { headers: wsHeaders() });
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch {
      // ignore
    }
  }, [workspace?.id, wsHeaders]);

  const fetchCampaigns = useCallback(async () => {
    if (!workspace?.id) return;
    setCampaignsLoading(true);
    try {
      const res = await fetch("/api/crm/whatsapp/campaigns", { headers: wsHeaders() });
      const data = await res.json();
      setCampaigns(data.campaigns || []);
    } catch {
      // ignore
    }
    setCampaignsLoading(false);
  }, [workspace?.id, wsHeaders]);

  const fetchSegments = useCallback(async () => {
    if (!workspace?.id) return;
    try {
      const res = await fetch("/api/crm/rfm?fields=summary", { headers: wsHeaders() });
      const data = await res.json();
      if (data.segments) {
        setSegments(
          data.segments.map((s: { segment: string; count: number }) => ({
            segment: s.segment,
            count: s.count,
          }))
        );
      }
    } catch {
      // ignore
    }
  }, [workspace?.id, wsHeaders]);

  useEffect(() => {
    fetchConfig();
    fetchTemplates();
    fetchCampaigns();
    fetchSegments();
  }, [fetchConfig, fetchTemplates, fetchCampaigns, fetchSegments]);

  // --- Actions ---

  async function handleSaveConfig() {
    setSavingConfig(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/crm/whatsapp/config", {
        method: "POST",
        headers: wsHeaders(),
        body: JSON.stringify({ phoneNumberId, wabaId, accessToken, displayPhone }),
      });
      const data = await res.json();
      if (data.error) {
        setErrorMsg(`Erro ao salvar: ${data.error}`);
      } else {
        setConfigured(true);
        setAccessToken("");
      }
    } catch (err) {
      setErrorMsg(`Erro de rede: ${err instanceof Error ? err.message : "desconhecido"}`);
    }
    setSavingConfig(false);
  }

  async function handleSyncTemplates() {
    setSyncingTemplates(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/crm/whatsapp/templates", {
        method: "POST",
        headers: wsHeaders(),
      });
      const data = await res.json();
      if (data.error) {
        setErrorMsg(`Erro ao sincronizar: ${data.error}`);
      } else {
        setTemplates(data.templates || []);
        if (data.synced === 0 && (!data.templates || data.templates.length === 0)) {
          setErrorMsg("Nenhum template encontrado. Verifique se o WABA ID esta correto — ele e diferente do Phone Number ID. Encontre-o no Meta Business Manager > Contas do WhatsApp.");
        }
      }
    } catch (err) {
      setErrorMsg(`Erro de rede: ${err instanceof Error ? err.message : "desconhecido"}`);
    }
    setSyncingTemplates(false);
  }

  async function handleCreateCampaign() {
    if (!selectedTemplate || !selectedSegment || !campaignName) return;
    setCreating(true);
    try {
      // Get customers from the selected segment
      const rfmRes = await fetch("/api/crm/rfm", { headers: wsHeaders() });
      const rfmData = await rfmRes.json();
      const customers = (rfmData.customers || []).filter(
        (c: { segment: string; phone: string }) =>
          c.segment === selectedSegment && c.phone
      );

      // Format phone numbers and build contacts list
      const contacts = customers.map((c: { phone: string; name: string }) => ({
        phone: formatPhone(c.phone),
        name: c.name || "",
        variables: Object.fromEntries(
          Object.entries(variableValues).map(([k, v]) => [
            k,
            v === "{{nome}}" ? c.name || "" : v,
          ])
        ),
      }));

      if (contacts.length === 0) {
        alert("Nenhum contato com telefone encontrado neste segmento.");
        setCreating(false);
        return;
      }

      // Create campaign
      const res = await fetch("/api/crm/whatsapp/campaigns", {
        method: "POST",
        headers: wsHeaders(),
        body: JSON.stringify({
          name: campaignName,
          templateId: selectedTemplate.id,
          segmentFilter: { segment: selectedSegment },
          variableValues,
          contacts,
        }),
      });
      const data = await res.json();

      if (data.campaign) {
        // Send immediately
        await fetch(`/api/crm/whatsapp/campaigns/${data.campaign.id}/send`, {
          method: "POST",
          headers: wsHeaders(),
        });
        setShowCreate(false);
        resetCreateForm();
        fetchCampaigns();
      }
    } catch {
      alert("Erro ao criar campanha.");
    }
    setCreating(false);
  }

  function resetCreateForm() {
    setCreateStep(1);
    setCampaignName("");
    setSelectedTemplate(null);
    setSelectedSegment("");
    setVariableValues({});
  }

  function formatPhone(phone: string): string {
    // Remove non-numeric, ensure +55 prefix
    const clean = phone.replace(/\D/g, "");
    if (clean.startsWith("55")) return clean;
    return `55${clean}`;
  }

  // --- Extract variables from selected template ---

  function getTemplateVars(): string[] {
    if (!selectedTemplate) return [];
    const vars: string[] = [];
    for (const comp of selectedTemplate.components) {
      if (comp.text) {
        const matches = comp.text.match(/\{\{(\d+)\}\}/g);
        if (matches) {
          for (const m of matches) {
            if (!vars.includes(m)) vars.push(m);
          }
        }
      }
    }
    return vars.sort();
  }

  function getTemplateBodyPreview(): string {
    if (!selectedTemplate) return "";
    const body = selectedTemplate.components.find((c) => c.type === "BODY");
    let text = body?.text || "";
    for (const [key, val] of Object.entries(variableValues)) {
      text = text.replace(key, val || key);
    }
    return text;
  }

  // --- Render ---

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
      draft: { variant: "outline", label: "Rascunho" },
      queued: { variant: "secondary", label: "Na fila" },
      sending: { variant: "default", label: "Enviando" },
      completed: { variant: "default", label: "Concluida" },
      failed: { variant: "destructive", label: "Falhou" },
    };
    const s = map[status] || { variant: "outline" as const, label: status };
    return <Badge variant={s.variant}>{s.label}</Badge>;
  };

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageCircle className="h-6 w-6" />
            WhatsApp Campaigns
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Envie mensagens em massa para seus segmentos via WhatsApp Business API
          </p>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">{errorMsg}</div>
          <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-300">
            <span className="sr-only">Fechar</span>&times;
          </button>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="campaigns" className="gap-1.5">
            <Send className="h-4 w-4" /> Campanhas
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-1.5">
            <FileText className="h-4 w-4" /> Templates
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-1.5">
            <Settings className="h-4 w-4" /> Configuracao
          </TabsTrigger>
        </TabsList>

        {/* ==================== CAMPAIGNS TAB ==================== */}
        <TabsContent value="campaigns" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              {campaigns.length} campanha(s)
            </p>
            <Dialog open={showCreate} onOpenChange={(open) => { setShowCreate(open); if (!open) resetCreateForm(); }}>
              <DialogTrigger asChild>
                <Button disabled={!configured || templates.length === 0}>
                  <Plus className="h-4 w-4 mr-2" /> Nova Campanha
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>
                    {createStep === 1 && "1. Segmento e Template"}
                    {createStep === 2 && "2. Editar Variaveis"}
                    {createStep === 3 && "3. Preview e Confirmar"}
                  </DialogTitle>
                </DialogHeader>

                {/* Step 1: Segment + Template */}
                {createStep === 1 && (
                  <div className="space-y-4">
                    <div>
                      <Label>Nome da campanha</Label>
                      <Input
                        value={campaignName}
                        onChange={(e) => setCampaignName(e.target.value)}
                        placeholder="Ex: Promo Champions Marco"
                      />
                    </div>

                    <div>
                      <Label>Segmento</Label>
                      <Select value={selectedSegment} onValueChange={setSelectedSegment}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecionar segmento..." />
                        </SelectTrigger>
                        <SelectContent>
                          {segments.map((s) => (
                            <SelectItem key={s.segment} value={s.segment}>
                              {SEGMENT_LABELS[s.segment] || s.segment} ({s.count} clientes)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Template</Label>
                      <Select
                        value={selectedTemplate?.id || ""}
                        onValueChange={(id) => {
                          const t = templates.find((t) => t.id === id);
                          setSelectedTemplate(t || null);
                          setVariableValues({});
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecionar template..." />
                        </SelectTrigger>
                        <SelectContent>
                          {templates
                            .filter((t) => t.status === "APPROVED")
                            .map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.name} ({t.language})
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {selectedTemplate && (
                      <div className="bg-muted/50 rounded-lg p-3 text-sm">
                        <p className="font-medium mb-1">Preview do template:</p>
                        <p className="whitespace-pre-wrap">
                          {selectedTemplate.components.find((c) => c.type === "BODY")?.text || "(sem corpo)"}
                        </p>
                      </div>
                    )}

                    <Button
                      className="w-full"
                      disabled={!campaignName || !selectedSegment || !selectedTemplate}
                      onClick={() => setCreateStep(getTemplateVars().length > 0 ? 2 : 3)}
                    >
                      Proximo
                    </Button>
                  </div>
                )}

                {/* Step 2: Edit Variables */}
                {createStep === 2 && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Preencha o valor para cada variavel do template. Use <code className="bg-muted px-1 rounded">{"{{nome}}"}</code> para preencher com o nome do contato.
                    </p>

                    {getTemplateVars().map((v) => (
                      <div key={v}>
                        <Label>{v}</Label>
                        <div className="flex gap-2">
                          <Input
                            value={variableValues[v] || ""}
                            onChange={(e) =>
                              setVariableValues((prev) => ({ ...prev, [v]: e.target.value }))
                            }
                            placeholder="Valor fixo ou {{nome}}"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setVariableValues((prev) => ({ ...prev, [v]: "{{nome}}" }))
                            }
                          >
                            Nome
                          </Button>
                        </div>
                      </div>
                    ))}

                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setCreateStep(1)}>
                        Voltar
                      </Button>
                      <Button className="flex-1" onClick={() => setCreateStep(3)}>
                        Proximo
                      </Button>
                    </div>
                  </div>
                )}

                {/* Step 3: Preview + Confirm */}
                {createStep === 3 && (
                  <div className="space-y-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Resumo</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Campanha:</span>
                          <span className="font-medium">{campaignName}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Segmento:</span>
                          <span className="font-medium">{SEGMENT_LABELS[selectedSegment] || selectedSegment}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Template:</span>
                          <span className="font-medium">{selectedTemplate?.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Destinatarios:</span>
                          <span className="font-medium">
                            {segments.find((s) => s.segment === selectedSegment)?.count || "?"} contatos
                          </span>
                        </div>
                      </CardContent>
                    </Card>

                    <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg p-4">
                      <p className="font-medium text-sm mb-2 flex items-center gap-1.5">
                        <Eye className="h-4 w-4" /> Preview da mensagem
                      </p>
                      <p className="text-sm whitespace-pre-wrap bg-white dark:bg-background rounded p-3 border">
                        {getTemplateBodyPreview()}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setCreateStep(getTemplateVars().length > 0 ? 2 : 1)}
                      >
                        Voltar
                      </Button>
                      <Button
                        className="flex-1"
                        onClick={handleCreateCampaign}
                        disabled={creating}
                      >
                        {creating ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Send className="h-4 w-4 mr-2" />
                        )}
                        Enviar Campanha
                      </Button>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>

          {/* Campaign list */}
          {campaignsLoading ? (
            <div className="text-center py-8 text-muted-foreground">Carregando...</div>
          ) : campaigns.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <MessageCircle className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p>Nenhuma campanha ainda.</p>
                <p className="text-xs mt-1">Crie sua primeira campanha de WhatsApp.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {campaigns.map((c) => (
                <Card key={c.id}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{c.name}</span>
                          {statusBadge(c.status)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Template: {c.wa_templates?.name || "—"} | Criada em{" "}
                          {new Date(c.created_at).toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <div className="text-center">
                          <div className="font-bold">{c.total_messages}</div>
                          <div className="text-xs text-muted-foreground">Total</div>
                        </div>
                        <div className="text-center">
                          <div className="font-bold text-blue-600">{c.sent_count}</div>
                          <div className="text-xs text-muted-foreground">Enviadas</div>
                        </div>
                        <div className="text-center">
                          <div className="font-bold text-green-600">{c.delivered_count}</div>
                          <div className="text-xs text-muted-foreground">Entregues</div>
                        </div>
                        <div className="text-center">
                          <div className="font-bold text-purple-600">{c.read_count}</div>
                          <div className="text-xs text-muted-foreground">Lidas</div>
                        </div>
                        {c.failed_count > 0 && (
                          <div className="text-center">
                            <div className="font-bold text-red-600">{c.failed_count}</div>
                            <div className="text-xs text-muted-foreground">Falhas</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={fetchCampaigns}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Atualizar
          </Button>
        </TabsContent>

        {/* ==================== TEMPLATES TAB ==================== */}
        <TabsContent value="templates" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              {templates.length} template(s) sincronizado(s)
            </p>
            <Button
              onClick={handleSyncTemplates}
              disabled={syncingTemplates || !configured}
              variant="outline"
            >
              {syncingTemplates ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Sincronizar da Meta
            </Button>
          </div>

          {templates.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p>Nenhum template encontrado.</p>
                <p className="text-xs mt-1">
                  Clique em &quot;Sincronizar da Meta&quot; para importar seus templates aprovados.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {templates.map((t) => (
                <Card key={t.id}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{t.name}</span>
                          <Badge
                            variant={t.status === "APPROVED" ? "default" : "secondary"}
                          >
                            {t.status}
                          </Badge>
                          <Badge variant="outline">{t.category}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Idioma: {t.language}
                        </p>
                      </div>
                    </div>
                    {t.components.find((c) => c.type === "BODY")?.text && (
                      <p className="text-sm mt-2 text-muted-foreground bg-muted/50 rounded p-2">
                        {t.components.find((c) => c.type === "BODY")?.text}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ==================== CONFIG TAB ==================== */}
        <TabsContent value="config" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Configuracao WhatsApp Business API
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {configured && (
                <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 dark:bg-green-950/20 rounded-lg p-3">
                  <CheckCircle2 className="h-4 w-4" />
                  WhatsApp configurado
                  {displayPhone && <span>| Numero: {displayPhone}</span>}
                </div>
              )}

              <div>
                <Label>Phone Number ID</Label>
                <Input
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="108594078879939"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Encontre em Meta Business &gt; WhatsApp &gt; API Setup
                </p>
              </div>

              <div>
                <Label>WABA ID (WhatsApp Business Account)</Label>
                <Input
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                  placeholder="123456789012345"
                />
              </div>

              <div>
                <Label>Access Token</Label>
                <Textarea
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="Token permanente da Meta API"
                  rows={3}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  O token sera armazenado criptografado. Gere um token permanente em Meta Business &gt; System Users.
                </p>
              </div>

              <div>
                <Label>Numero exibido (opcional)</Label>
                <Input
                  value={displayPhone}
                  onChange={(e) => setDisplayPhone(e.target.value)}
                  placeholder="+55 62 98595-5001"
                />
              </div>

              <Button
                onClick={handleSaveConfig}
                disabled={savingConfig || !phoneNumberId || !wabaId || (!accessToken && !configured)}
              >
                {savingConfig ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Salvar Configuracao
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
