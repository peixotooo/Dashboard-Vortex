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
  Sparkles,
  ListChecks,
  MinusCircle,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  cooldownDays?: number;
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
  cooldownDays = 7,
}: CampaignCreateDialogProps) {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id || "";

  // Step state
  const [step, setStep] = useState(0);

  // Step 1: Name & audience
  const [campaignName, setCampaignName] = useState("");
  const [contactSearch, setContactSearch] = useState("");

  // Audience source override + exclusion list
  // - "filtros": usa o prop `contacts` (filtros atuais do CRM)
  // - "lista":   troca por uma lista personalizada
  const [audienceSource, setAudienceSource] = useState<"filtros" | "lista">("filtros");
  const [audienceListId, setAudienceListId] = useState<string>("");
  const [excludeListId, setExcludeListId] = useState<string>("");
  const [contactLists, setContactLists] = useState<Array<{
    id: string;
    name: string;
    total_count: number;
    phone_count: number;
  }>>([]);
  // contatos da lista de audiência selecionada (resolvidos via API)
  const [audienceListContacts, setAudienceListContacts] = useState<Contact[]>([]);
  const [audienceListLoading, setAudienceListLoading] = useState(false);
  // Set de telefones (digits only) a excluir
  const [excludePhoneSet, setExcludePhoneSet] = useState<Set<string>>(new Set());
  const [excludeLoading, setExcludeLoading] = useState(false);

  // Step 2: Template
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [waConfigured, setWaConfigured] = useState(true);

  // Step 3: Variables
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [copyPrompt, setCopyPrompt] = useState("");
  const [copyLoading, setCopyLoading] = useState(false);

  // Step 4: Schedule + Attribution
  const [scheduleMode, setScheduleMode] = useState<"now" | "scheduled">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [attributionDays, setAttributionDays] = useState(3);
  const [messageCostUsd, setMessageCostUsd] = useState(0.0625);
  const [exchangeRate, setExchangeRate] = useState(5.50);

  // Compliance
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceResult, setComplianceResult] = useState<{
    cooldownCount: number;
    blockedCount: number;
    allowedCount: number;
  } | null>(null);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });

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
      setCopyPrompt("");
      setCopyLoading(false);
      setAttributionDays(3);
      setMessageCostUsd(0.0625);
      setExchangeRate(5.50);
      setComplianceResult(null);
      setComplianceLoading(false);
      setAudienceSource("filtros");
      setAudienceListId("");
      setExcludeListId("");
      setAudienceListContacts([]);
      setExcludePhoneSet(new Set());
    }
  }, [open, suggestedName]);

  // Fetch das listas personalizadas
  useEffect(() => {
    if (!open || !workspaceId) return;
    fetch("/api/crm/contact-lists", { headers: { "x-workspace-id": workspaceId } })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.lists)) setContactLists(data.lists);
      })
      .catch(() => {});
  }, [open, workspaceId]);

  // Resolve contatos da lista de audiência selecionada
  useEffect(() => {
    if (audienceSource !== "lista" || !audienceListId || !workspaceId) {
      setAudienceListContacts([]);
      return;
    }
    setAudienceListLoading(true);
    fetch(`/api/crm/contact-lists/${audienceListId}`, {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((data) => {
        const list = data.list as { contacts?: Array<{ phone?: string; email?: string; name?: string }> } | null;
        const mapped: Contact[] = (list?.contacts || []).map((c) => ({
          name: c.name || "",
          email: c.email || "",
          phone: c.phone || "",
        }));
        setAudienceListContacts(mapped);
      })
      .catch(() => setAudienceListContacts([]))
      .finally(() => setAudienceListLoading(false));
  }, [audienceSource, audienceListId, workspaceId]);

  // Resolve telefones a excluir
  useEffect(() => {
    if (!excludeListId || !workspaceId) {
      setExcludePhoneSet(new Set());
      return;
    }
    setExcludeLoading(true);
    fetch(`/api/crm/contact-lists/${excludeListId}`, {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((data) => {
        const list = data.list as { contacts?: Array<{ phone?: string }> } | null;
        const set = new Set<string>();
        for (const c of list?.contacts || []) {
          if (c.phone) set.add(c.phone.replace(/\D/g, ""));
        }
        setExcludePhoneSet(set);
      })
      .catch(() => setExcludePhoneSet(new Set()))
      .finally(() => setExcludeLoading(false));
  }, [excludeListId, workspaceId]);

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

  // Computed: contatos da audiência conforme a fonte (filtros vs lista)
  const sourceContacts = useMemo(
    () => (audienceSource === "lista" ? audienceListContacts : contacts),
    [audienceSource, audienceListContacts, contacts]
  );

  // Valid contacts (have phone) — depois aplica a exclusion list
  const validContacts = useMemo(() => {
    const withPhone = sourceContacts.filter((c) => c.phone && c.phone.trim().length > 0);
    if (excludePhoneSet.size === 0) return withPhone;
    return withPhone.filter((c) => !excludePhoneSet.has(c.phone.replace(/\D/g, "")));
  }, [sourceContacts, excludePhoneSet]);

  const invalidCount = sourceContacts.length - validContacts.length;
  const excludedCount = useMemo(() => {
    if (excludePhoneSet.size === 0) return 0;
    return sourceContacts.filter(
      (c) => c.phone && c.phone.trim() && excludePhoneSet.has(c.phone.replace(/\D/g, ""))
    ).length;
  }, [sourceContacts, excludePhoneSet]);

  // Fetch compliance preview when dialog opens
  useEffect(() => {
    if (!open || !workspaceId || validContacts.length === 0) return;
    setComplianceLoading(true);
    fetch("/api/crm/whatsapp/compliance-check", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId },
      body: JSON.stringify({
        phones: validContacts.map((c) => c.phone),
        cooldownDays,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) {
          setComplianceResult({
            cooldownCount: data.cooldownCount || 0,
            blockedCount: data.blockedCount || 0,
            allowedCount: data.allowedCount || validContacts.length,
          });
        }
      })
      .catch(() => setComplianceResult(null))
      .finally(() => setComplianceLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId, validContacts.length, cooldownDays]);

  // Filtered contacts for display
  const displayContacts = useMemo(() => {
    if (!contactSearch) return sourceContacts;
    const q = contactSearch.toLowerCase();
    return sourceContacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.phone.includes(q)
    );
  }, [sourceContacts, contactSearch]);

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

  // Generate copy via AI
  const handleGenerateCopy = useCallback(async () => {
    if (copyLoading || templateVars.length === 0) return;
    setCopyLoading(true);
    try {
      const res = await fetch("/api/crm/whatsapp/generate-copy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          campaignName: campaignName.trim(),
          templateBody,
          variables: templateVars,
          userPrompt: copyPrompt.trim(),
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.values && Object.keys(data.values).length > 0) {
        setVariableValues((prev) => ({ ...prev, ...data.values }));
      }
    } catch {
      // Silent — user can fill manually
    } finally {
      setCopyLoading(false);
    }
  }, [copyLoading, templateVars, workspaceId, campaignName, templateBody, copyPrompt]);

  // Submit campaign — divide audiências grandes em batches pra não
  // estourar o body limit do Vercel (4.5MB). 1ª batch cria a campanha
  // + agendamento + variáveis; demais só anexam contatos via campaign_id.
  const handleSubmit = useCallback(async () => {
    const BATCH_SIZE = 3000;
    setSubmitting(true);
    setSubmitError("");
    setProgress({ done: 0, total: validContacts.length });
    try {
      const contactsPayload = validContacts.map((c) => ({
        phone: c.phone,
        name: c.name,
        variables: templateVars.length > 0 ? variableValues : undefined,
      }));

      // 1) Primeira batch — cria a campanha
      const firstBatch = contactsPayload.slice(0, BATCH_SIZE);
      const restBatches: typeof contactsPayload[] = [];
      for (let i = BATCH_SIZE; i < contactsPayload.length; i += BATCH_SIZE) {
        restBatches.push(contactsPayload.slice(i, i + BATCH_SIZE));
      }

      const segmentFilter: Record<string, unknown> = {};
      if (audienceSource === "lista" && audienceListId) {
        segmentFilter.contact_list_id = audienceListId;
        const meta = contactLists.find((l) => l.id === audienceListId);
        if (meta) segmentFilter.contact_list_name = meta.name;
      }
      if (excludeListId) {
        segmentFilter.exclude_contact_list_id = excludeListId;
        const meta = contactLists.find((l) => l.id === excludeListId);
        if (meta) segmentFilter.exclude_contact_list_name = meta.name;
      }

      const body: Record<string, unknown> = {
        name: campaignName.trim(),
        templateId: selectedTemplateId,
        contacts: firstBatch,
        variableValues: templateVars.length > 0 ? variableValues : {},
        segmentFilter,
        attribution_window_days: attributionDays,
        message_cost_usd: messageCostUsd,
        exchange_rate: exchangeRate,
        cooldownDays,
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

      const data = await res.json();
      const campaignId = data.campaign?.id;
      setProgress({ done: firstBatch.length, total: contactsPayload.length });

      // 2) Anexa restantes em batches sequenciais
      if (campaignId && restBatches.length > 0) {
        let done = firstBatch.length;
        for (const batch of restBatches) {
          const appendRes = await fetch("/api/crm/whatsapp/campaigns", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-workspace-id": workspaceId,
            },
            body: JSON.stringify({ campaign_id: campaignId, contacts: batch, cooldownDays }),
          });
          if (!appendRes.ok) {
            const errData = await appendRes.json().catch(() => ({}));
            throw new Error(errData.error || `Erro anexando batch: ${appendRes.status}`);
          }
          done += batch.length;
          setProgress({ done, total: contactsPayload.length });
        }
      }

      setSubmitSuccess(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Erro ao criar campanha");
    } finally {
      setSubmitting(false);
    }
  }, [campaignName, selectedTemplateId, validContacts, variableValues, templateVars.length, scheduleMode, scheduledAt, workspaceId, attributionDays, messageCostUsd, exchangeRate, cooldownDays]);

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

<div className="space-y-2 border rounded-md p-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" /> Fonte da audiência
                  </label>
                </div>
                <div className="flex gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setAudienceSource("filtros")}
                    className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                      audienceSource === "filtros"
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                  >
                    Filtros atuais ({contacts.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAudienceSource("lista")}
                    className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
                      audienceSource === "lista"
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                  >
                    <ListChecks className="h-3 w-3" /> Lista personalizada
                  </button>
                </div>
                {audienceSource === "lista" && (
                  <Select value={audienceListId} onValueChange={setAudienceListId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecionar lista..." />
                    </SelectTrigger>
                    <SelectContent>
                      {contactLists.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          Nenhuma lista. Crie em /crm/listas.
                        </div>
                      ) : (
                        contactLists.map((l) => (
                          <SelectItem key={l.id} value={l.id} disabled={l.phone_count === 0}>
                            {l.name} ({l.phone_count} com telefone / {l.total_count} total)
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                )}

                <div className="pt-2 border-t border-border/50 space-y-2">
                  <label className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <MinusCircle className="h-3.5 w-3.5" /> Excluir lista (opcional)
                  </label>
                  <Select
                    value={excludeListId || "__none__"}
                    onValueChange={(v) => setExcludeListId(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Não excluir nenhuma..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Não excluir</SelectItem>
                      {contactLists.map((l) => (
                        <SelectItem key={l.id} value={l.id} disabled={l.phone_count === 0}>
                          {l.name} ({l.phone_count} com telefone)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {excludeListId && excludePhoneSet.size > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      {excludePhoneSet.size} telefone(s) na lista de exclusão.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">
                    Audiencia: {validContacts.length} contatos
                    {audienceListLoading && (
                      <Loader2 className="inline h-3 w-3 animate-spin ml-2" />
                    )}
                    {invalidCount > 0 && (
                      <span className="text-xs text-amber-400 ml-2">
                        ({invalidCount} sem telefone)
                      </span>
                    )}
                    {excludedCount > 0 && (
                      <span className="text-xs text-amber-400 ml-2">
                        ({excludedCount} excluído{excludedCount > 1 ? "s" : ""} pela lista)
                      </span>
                    )}
                    {excludeLoading && (
                      <Loader2 className="inline h-3 w-3 animate-spin ml-2" />
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

                {/* Compliance warnings */}
                {complianceLoading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Verificando politica de compliance...
                  </div>
                )}
                {complianceResult && (complianceResult.cooldownCount > 0 || complianceResult.blockedCount > 0) && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-amber-400">
                      <AlertTriangle className="h-4 w-4" />
                      {complianceResult.cooldownCount + complianceResult.blockedCount} contatos serao excluidos
                    </div>
                    {complianceResult.cooldownCount > 0 && (
                      <p className="text-xs text-amber-400/80 ml-6">
                        {complianceResult.cooldownCount} em periodo de cooldown ({cooldownDays}d)
                      </p>
                    )}
                    {complianceResult.blockedCount > 0 && (
                      <p className="text-xs text-amber-400/80 ml-6">
                        {complianceResult.blockedCount} na lista de exclusao
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground ml-6">
                      Serao enviadas para {complianceResult.allowedCount} contatos
                    </p>
                  </div>
                )}

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
                          <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${
                            t.category === "MARKETING"
                              ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                              : "bg-sky-500/10 text-sky-400 border-sky-500/20"
                          }`}>
                            {t.category === "MARKETING" ? "Marketing" : "Utilidade"}
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
                  {/* AI Copy Assistant */}
                  <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-sky-400 shrink-0" />
                      <p className="text-sm font-medium">Assistente de Copy</p>
                    </div>
                    <textarea
                      value={copyPrompt}
                      onChange={(e) => setCopyPrompt(e.target.value)}
                      placeholder="Descreva o objetivo da campanha... (ex: reativar clientes inativos com 15% de desconto)"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
                      rows={2}
                      disabled={copyLoading}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-xs"
                      onClick={handleGenerateCopy}
                      disabled={copyLoading}
                    >
                      {copyLoading ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Gerando...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" />
                          Gerar com IA
                        </>
                      )}
                    </Button>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Preencha as variaveis do template abaixo ou use o assistente acima.
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
                        placeholder={`Valor para ${v}`}
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

              {/* Attribution / Conversion tracking */}
              <div className="rounded-lg border border-border p-4 space-y-3">
                <p className="text-sm font-medium">Monitoramento de Conversao</p>
                <p className="text-xs text-muted-foreground">
                  Acompanhe se os clientes desta campanha compraram apos receberem a mensagem.
                </p>

                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Janela de atribuicao</label>
                  <select
                    value={attributionDays}
                    onChange={(e) => setAttributionDays(Number(e.target.value))}
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    {[1, 3, 5, 7, 14, 30].map((d) => (
                      <option key={d} value={d}>
                        {d} {d === 1 ? "dia" : "dias"}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Custo por msg (USD)</label>
                    <Input
                      type="number"
                      step="0.001"
                      min="0"
                      value={messageCostUsd}
                      onChange={(e) => setMessageCostUsd(Number(e.target.value) || 0)}
                      className="h-9 text-sm"
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">Marketing: $0.0625 | Utilidade: $0.0080</p>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Cambio USD→BRL</label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={exchangeRate}
                      onChange={(e) => setExchangeRate(Number(e.target.value) || 0)}
                      className="h-9 text-sm"
                    />
                  </div>
                </div>

                <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Custo estimado: <strong className="text-foreground">R$ {(validContacts.length * messageCostUsd * exchangeRate).toFixed(2)}</strong>{" "}
                  ({validContacts.length} msgs × ${messageCostUsd} × {exchangeRate})
                </div>
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
                    {progress.total > 0
                      ? `Enviando ${progress.done.toLocaleString("pt-BR")} / ${progress.total.toLocaleString("pt-BR")}...`
                      : "Criando..."}
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
