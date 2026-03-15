"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Search,
  ChevronLeft,
  ChevronRight,
  Check,
  Clock,
  Send,
  AlertTriangle,
  MessageSquare,
  Users,
  Phone,
} from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import {
  extractTemplateVariables,
  getTemplateBodyText,
} from "@/lib/whatsapp-api";
import type { WaTemplateComponent } from "@/lib/whatsapp-api";

// --- Types ---

interface Contact {
  name: string;
  email: string;
  phone: string;
}

interface Template {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: WaTemplateComponent[];
}

interface CampaignCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: Contact[];
  suggestedName?: string;
}

// --- Steps ---

const STEPS = [
  { label: "Audiencia", icon: Users },
  { label: "Template", icon: MessageSquare },
  { label: "Variaveis", icon: Phone },
  { label: "Confirmar", icon: Send },
];

// --- Component ---

export function CampaignCreateDialog({
  open,
  onOpenChange,
  contacts,
  suggestedName,
}: CampaignCreateDialogProps) {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id || "";

  // Step state
  const [step, setStep] = useState(0);

  // Step 1: Name & audience
  const [campaignName, setCampaignName] = useState("");
  const [contactSearch, setContactSearch] = useState("");

  // Step 2: Template
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [waConfigured, setWaConfigured] = useState(true);

  // Step 3: Variables
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  // Step 4: Schedule
  const [scheduleMode, setScheduleMode] = useState<"now" | "scheduled">("now");
  const [scheduledAt, setScheduledAt] = useState("");

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep(0);
      setCampaignName(suggestedName || "");
      setContactSearch("");
      setTemplateSearch("");
      setSelectedTemplateId(null);
      setVariableValues({});
      setScheduleMode("now");
      setScheduledAt("");
      setSubmitting(false);
      setSubmitError("");
      setSubmitSuccess(false);
    }
  }, [open, suggestedName]);

  // Fetch templates on step 2
  useEffect(() => {
    if (step === 1 && templates.length === 0 && !templatesLoading) {
      fetchTemplates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function fetchTemplates() {
    setTemplatesLoading(true);
    try {
      const res = await fetch("/api/crm/whatsapp/templates", {
        headers: { "x-workspace-id": workspaceId },
      });
      if (!res.ok) {
        if (res.status === 400) setWaConfigured(false);
        return;
      }
      const data = await res.json();
      setTemplates(data.templates || []);
      if ((data.templates || []).length === 0) {
        // Check if WhatsApp is configured
        const cfgRes = await fetch("/api/crm/whatsapp/config", {
          headers: { "x-workspace-id": workspaceId },
        });
        const cfg = await cfgRes.json();
        if (!cfg.configured) setWaConfigured(false);
      }
    } catch {
      // Silent
    } finally {
      setTemplatesLoading(false);
    }
  }

  // Computed: valid contacts (have phone)
  const validContacts = useMemo(
    () => contacts.filter((c) => c.phone && c.phone.trim().length > 0),
    [contacts]
  );
  const invalidCount = contacts.length - validContacts.length;

  // Filtered contacts for display
  const displayContacts = useMemo(() => {
    if (!contactSearch) return contacts;
    const q = contactSearch.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.phone.includes(q)
    );
  }, [contacts, contactSearch]);

  // Filtered templates
  const displayTemplates = useMemo(() => {
    let list = templates.filter((t) => t.status === "APPROVED");
    if (templateSearch) {
      const q = templateSearch.toLowerCase();
      list = list.filter((t) => t.name.toLowerCase().includes(q));
    }
    return list;
  }, [templates, templateSearch]);

  // Selected template
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );

  // Variables from selected template
  const templateVars = useMemo(
    () => (selectedTemplate ? extractTemplateVariables(selectedTemplate.components) : []),
    [selectedTemplate]
  );

  const templateBody = useMemo(
    () => (selectedTemplate ? getTemplateBodyText(selectedTemplate.components) : ""),
    [selectedTemplate]
  );

  // Reset variables when template changes
  useEffect(() => {
    const newVars: Record<string, string> = {};
    for (const v of templateVars) {
      newVars[v] = variableValues[v] || "";
    }
    setVariableValues(newVars);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplateId, templateVars.length]);

  // Preview body with vars replaced
  const previewBody = useMemo(() => {
    let text = templateBody;
    for (const [key, val] of Object.entries(variableValues)) {
      text = text.replace(key, val || key);
    }
    return text;
  }, [templateBody, variableValues]);

  // Can advance to next step
  const canAdvance = useMemo(() => {
    switch (step) {
      case 0:
        return campaignName.trim().length > 0 && validContacts.length > 0;
      case 1:
        return selectedTemplateId !== null;
      case 2:
        return templateVars.length === 0 || Object.values(variableValues).every((v) => v.trim().length > 0);
      case 3:
        return scheduleMode === "now" || (scheduleMode === "scheduled" && scheduledAt.length > 0);
      default:
        return false;
    }
  }, [step, campaignName, validContacts.length, selectedTemplateId, templateVars.length, variableValues, scheduleMode, scheduledAt]);

  // Submit campaign
  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const contactsPayload = validContacts.map((c) => ({
        phone: c.phone,
        name: c.name,
        variables: templateVars.length > 0 ? variableValues : undefined,
      }));

      const body: Record<string, unknown> = {
        name: campaignName.trim(),
        templateId: selectedTemplateId,
        contacts: contactsPayload,
        variableValues: templateVars.length > 0 ? variableValues : {},
        segmentFilter: {},
      };

      if (scheduleMode === "scheduled" && scheduledAt) {
        body.scheduled_at = new Date(scheduledAt).toISOString();
      }

      const res = await fetch("/api/crm/whatsapp/campaigns", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Erro ${res.status}`);
      }

      setSubmitSuccess(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Erro ao criar campanha");
    } finally {
      setSubmitting(false);
    }
  }, [campaignName, selectedTemplateId, validContacts, variableValues, templateVars.length, scheduleMode, scheduledAt, workspaceId]);

  // --- Render ---

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Criar Campanha WhatsApp</DialogTitle>
          <DialogDescription>
            {STEPS[step]?.label} — Etapa {step + 1} de {STEPS.length}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 px-1">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === step;
            const isDone = i < step;
            return (
              <React.Fragment key={i}>
                {i > 0 && (
                  <div className={`flex-1 h-px ${isDone ? "bg-primary" : "bg-border"}`} />
                )}
                <div
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : isDone
                      ? "text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  {isDone ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0 py-2">
          {/* ===== Step 0: Name & Audience ===== */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Nome da Campanha</label>
                <Input
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="Ex: Reativacao VIP Marco 2026"
                  autoFocus
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">
                    Audiencia: {validContacts.length} contatos
                    {invalidCount > 0 && (
                      <span className="text-xs text-amber-400 ml-2">
                        ({invalidCount} sem telefone)
                      </span>
                    )}
                  </p>
                  <div className="relative w-48">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      placeholder="Buscar..."
                      className="pl-8 h-8 text-xs"
                    />
                  </div>
                </div>

                <div className="border border-border rounded-md max-h-60 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card border-b border-border">
                      <tr>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground">Nome</th>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground">Telefone</th>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground">Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayContacts.slice(0, 200).map((c, i) => (
                        <tr
                          key={i}
                          className={`border-b border-border/30 ${
                            !c.phone ? "opacity-40" : "hover:bg-muted/30"
                          }`}
                        >
                          <td className="py-1.5 px-3">{c.name}</td>
                          <td className="py-1.5 px-3">
                            {c.phone || (
                              <span className="text-amber-400 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" /> Sem telefone
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 px-3 text-muted-foreground">{c.email}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {displayContacts.length > 200 && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      ... e mais {displayContacts.length - 200} contatos
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ===== Step 1: Template ===== */}
          {step === 1 && (
            <div className="space-y-3">
              {!waConfigured && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-400">
                  <AlertTriangle className="h-4 w-4 inline mr-1.5" />
                  WhatsApp nao configurado. Configure em <strong>CRM &gt; WhatsApp &gt; Configuracao</strong>.
                </div>
              )}

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  placeholder="Buscar template..."
                  className="pl-9"
                />
              </div>

              {templatesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : displayTemplates.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Nenhum template aprovado encontrado.
                  {templates.length > 0 && " Verifique o status dos templates na Meta."}
                </p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {displayTemplates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTemplateId(t.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                        selectedTemplateId === t.id
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-border hover:border-primary/30 hover:bg-muted/30"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold">{t.name}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                            {t.status}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{t.language}</span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {getTemplateBodyText(t.components) || "Sem texto"}
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {/* Preview */}
              {selectedTemplate && (
                <div className="mt-3 p-3 rounded-lg bg-muted/30 border border-border">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Preview</p>
                  <p className="text-sm whitespace-pre-wrap">
                    {getTemplateBodyText(selectedTemplate.components) || "—"}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ===== Step 2: Variables ===== */}
          {step === 2 && (
            <div className="space-y-4">
              {templateVars.length === 0 ? (
                <div className="text-center py-8">
                  <Check className="h-8 w-8 text-green-400 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Este template nao possui variaveis. Prossiga para o proximo passo.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Preencha as variaveis do template. Use <code className="text-primary">{`{{nome}}`}</code> para inserir o nome do contato automaticamente.
                  </p>
                  {templateVars.map((v) => (
                    <div key={v}>
                      <label className="text-sm font-medium mb-1 block">
                        Variavel {v}
                      </label>
                      <Input
                        value={variableValues[v] || ""}
                        onChange={(e) =>
                          setVariableValues((prev) => ({ ...prev, [v]: e.target.value }))
                        }
                        placeholder={`Valor para ${v} (ex: 10%, {{nome}})`}
                      />
                    </div>
                  ))}

                  <div className="mt-3 p-3 rounded-lg bg-muted/30 border border-border">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Preview</p>
                    <p className="text-sm whitespace-pre-wrap">{previewBody}</p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ===== Step 3: Schedule & Confirm ===== */}
          {step === 3 && !submitSuccess && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="rounded-lg border border-border p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Campanha</span>
                  <span className="font-semibold">{campaignName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Contatos</span>
                  <span className="font-semibold">{validContacts.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Template</span>
                  <span className="font-semibold">{selectedTemplate?.name}</span>
                </div>
                {templateVars.length > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Variaveis</span>
                    <span className="font-semibold">
                      {Object.entries(variableValues)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(", ")}
                    </span>
                  </div>
                )}
              </div>

              {/* Schedule options */}
              <div className="space-y-3">
                <p className="text-sm font-medium">Quando disparar?</p>
                <label className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/30 transition-colors">
                  <input
                    type="radio"
                    name="schedule"
                    checked={scheduleMode === "now"}
                    onChange={() => setScheduleMode("now")}
                    className="accent-primary"
                  />
                  <Send className="h-4 w-4 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Disparar agora</p>
                    <p className="text-xs text-muted-foreground">
                      A campanha sera processada imediatamente pelo cron (ate 2 min)
                    </p>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/30 transition-colors">
                  <input
                    type="radio"
                    name="schedule"
                    checked={scheduleMode === "scheduled"}
                    onChange={() => setScheduleMode("scheduled")}
                    className="accent-primary"
                  />
                  <Clock className="h-4 w-4 text-amber-400 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Agendar para</p>
                    <p className="text-xs text-muted-foreground mb-2">
                      A campanha sera disparada no horario agendado
                    </p>
                    {scheduleMode === "scheduled" && (
                      <input
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={(e) => setScheduledAt(e.target.value)}
                        min={new Date().toISOString().slice(0, 16)}
                        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    )}
                  </div>
                </label>
              </div>

              {submitError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
                  {submitError}
                </div>
              )}
            </div>
          )}

          {/* Success */}
          {submitSuccess && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="h-14 w-14 rounded-full bg-green-500/10 flex items-center justify-center">
                <Check className="h-7 w-7 text-green-400" />
              </div>
              <h3 className="text-lg font-semibold">Campanha criada!</h3>
              <p className="text-sm text-muted-foreground text-center max-w-xs">
                {scheduleMode === "now"
                  ? `${validContacts.length} mensagens serao enviadas em breve.`
                  : `${validContacts.length} mensagens agendadas para ${new Date(scheduledAt).toLocaleString("pt-BR")}.`}
              </p>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="mt-2"
              >
                Fechar
              </Button>
            </div>
          )}
        </div>

        {/* Footer navigation */}
        {!submitSuccess && (
          <div className="flex items-center justify-between pt-3 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep((s) => s - 1)}
              disabled={step === 0}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Voltar
            </Button>

            {step < STEPS.length - 1 ? (
              <Button
                size="sm"
                onClick={() => setStep((s) => s + 1)}
                disabled={!canAdvance}
                className="gap-1"
              >
                Proximo
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!canAdvance || submitting}
                className="gap-1"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Criando...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Criar Campanha
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
