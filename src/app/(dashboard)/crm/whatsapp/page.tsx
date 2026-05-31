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
import { TemplateCreateDialog } from "@/components/crm/template-create-dialog";
import { CampaignDetailsDialog } from "@/components/crm/campaign-details-dialog";
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
  ShieldOff,
  Trash2,
  Image,
  Video,
  Link,
  Hash,
  Search,
  MousePointerClick,
  Copy,
  Timer,
  Layers,
  Phone,
  X,
  ShieldCheck,
  ShieldX,
  FileEdit,
  Play,
  Pencil,
  Sparkles,
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
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  template_id?: string | null;
  variable_values?: Record<string, string> | null;
  wa_templates: { name: string; language: string } | null;
  attribution_window_days?: number;
  message_cost_usd?: number;
  exchange_rate?: number;
  submitted_by?: string | null;
  submitted_at?: string | null;
  rejection_reason?: string | null;
}

interface PerformanceData {
  conversions: number;
  attributed_revenue: number;
  total_cost_usd: number;
  total_cost_brl: number;
  roi_pct: number;
  window_days: number;
  window_active: boolean;
  window_ends_at: string | null;
  sent_count: number;
  real_cost_usd?: number;
  real_cost_brl?: number;
  cost_source?: "meta_api" | "estimated";
}

interface MonthlySpend {
  totalUsd: number;
  totalBrl: number;
  breakdown: Array<{
    category: string;
    type: string;
    volume: number;
    costUsd: number;
    costBrl: number;
  }>;
  period?: { start: string; end: string };
  source?: "pricing_analytics" | "template_analytics";
  templateMetrics?: Array<{
    templateId: string;
    sent: number;
    delivered: number;
    read: number;
    costUsd: number;
    clicked: number;
    deliveryRate: number;
    openRate: number;
    ctr: number;
  }>;
}

interface RfmSegment {
  segment: string;
  count: number;
}

interface WaExclusion {
  id: string;
  phone: string;
  contact_name: string | null;
  reason: string;
  notes: string | null;
  created_at: string;
}

interface RetentionWaContext {
  runId: string;
  playbookId: string;
  playbookName: string;
  audienceName: string;
  sourceListId: string;
  templateHint: string;
  messageGoal: string;
  guardrail: string;
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

  // Performance data
  const [perfData, setPerfData] = useState<Record<string, PerformanceData>>({});
  const [monthlySpend, setMonthlySpend] = useState<MonthlySpend | null>(null);
  const [spendLoading, setSpendLoading] = useState(false);

  // Compliance
  const [cooldownDays, setCooldownDays] = useState(7);
  const [exclusions, setExclusions] = useState<WaExclusion[]>([]);
  const [exclusionsLoading, setExclusionsLoading] = useState(false);
  const [newExcPhone, setNewExcPhone] = useState("");
  const [newExcName, setNewExcName] = useState("");
  const [newExcReason, setNewExcReason] = useState("manual");
  const [newExcNotes, setNewExcNotes] = useState("");
  const [addingExclusion, setAddingExclusion] = useState(false);

  // Campaign creation state
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState(1);
  const [campaignName, setCampaignName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<WaTemplate | null>(null);
  const [audienceMode, setAudienceMode] = useState<"segment" | "list">("segment");
  const [selectedSegment, setSelectedSegment] = useState("");
  const [selectedListId, setSelectedListId] = useState("");
  const [excludeListId, setExcludeListId] = useState("");
  const [contactLists, setContactLists] = useState<Array<{ id: string; name: string; total_count: number; phone_count: number }>>([]);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [segments, setSegments] = useState<RfmSegment[]>([]);
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showTemplateCreate, setShowTemplateCreate] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateFilter, setTemplateFilter] = useState<"all" | "APPROVED" | "PENDING" | "REJECTED">("all");
  const [previewTemplate, setPreviewTemplate] = useState<WaTemplate | null>(null);
  const [detailsCampaignId, setDetailsCampaignId] = useState<string | null>(null);
  const [retentionContext, setRetentionContext] = useState<RetentionWaContext | null>(null);
  const [copyPrompt, setCopyPrompt] = useState("");
  const [copyLoading, setCopyLoading] = useState(false);

  // Modo "rascunho com aprovação" — campanha fica em pending_approval
  // até outro membro do time aprovar.
  const [requiresApproval, setRequiresApproval] = useState(false);
  // Modo "rascunho pessoal" — campanha fica em draft, sem ir pra Meta,
  // até o próprio usuário clicar em Ativar.
  const [saveAsDraft, setSaveAsDraft] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  const [activateBusyId, setActivateBusyId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);

  // Edição inline (rascunho + agendamento).
  const [editingCampaign, setEditingCampaign] = useState<WaCampaign | null>(null);
  const [editName, setEditName] = useState("");
  const [editScheduleEnabled, setEditScheduleEnabled] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editVariableValues, setEditVariableValues] = useState<Record<string, string>>({});
  const [editBusy, setEditBusy] = useState(false);

  // Rascunho com aprovação obriga agendamento — força o toggle ao ligar.
  useEffect(() => {
    if (requiresApproval) setScheduleEnabled(true);
  }, [requiresApproval]);

  // Os dois modos de rascunho são mutuamente exclusivos.
  useEffect(() => {
    if (saveAsDraft && requiresApproval) setRequiresApproval(false);
  }, [saveAsDraft, requiresApproval]);

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
      setPerfData({});
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

  const fetchContactLists = useCallback(async () => {
    if (!workspace?.id) return;
    try {
      const res = await fetch("/api/crm/contact-lists", { headers: wsHeaders() });
      const data = await res.json();
      if (Array.isArray(data.lists)) {
        setContactLists(
          data.lists.map((l: { id: string; name: string; total_count: number; phone_count: number }) => ({
            id: l.id,
            name: l.name,
            total_count: l.total_count,
            phone_count: l.phone_count,
          }))
        );
      }
    } catch {
      // ignore
    }
  }, [workspace?.id, wsHeaders]);

  const fetchExclusions = useCallback(async () => {
    if (!workspace?.id) return;
    setExclusionsLoading(true);
    try {
      const res = await fetch("/api/crm/whatsapp/exclusions", { headers: wsHeaders() });
      const data = await res.json();
      setExclusions(data.exclusions || []);
    } catch {
      // ignore
    }
    setExclusionsLoading(false);
  }, [workspace?.id, wsHeaders]);

  // Fetch attribution/performance for campaigns that already sent messages.
  useEffect(() => {
    if (campaigns.length === 0 || !workspace?.id) return;
    const trackable = campaigns.filter((c) =>
      ["completed", "sending", "failed"].includes(c.status) && (c.sent_count || 0) > 0
    );
    if (trackable.length === 0) return;

    const newIds = trackable.filter((c) => !perfData[c.id]).map((c) => c.id);
    if (newIds.length === 0) return;

    fetch("/api/crm/whatsapp/campaigns/performance", {
      method: "POST",
      headers: { ...wsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ ids: newIds }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.results) {
          setPerfData((prev) => ({ ...prev, ...data.results }));
        }
      })
      .catch(() => { /* silent */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, workspace?.id]);

  useEffect(() => {
    fetchConfig();
    fetchTemplates();
    fetchCampaigns();
    fetchSegments();
    fetchExclusions();
    fetchContactLists();
  }, [fetchConfig, fetchTemplates, fetchCampaigns, fetchSegments, fetchExclusions, fetchContactLists]);

  // Suporte a ?list=<id> na URL — abre o dialog de criação já com a
  // lista personalizada selecionada como audiência.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const listId = params.get("list");
    const presetName = params.get("name");
    if (listId && contactLists.some((l) => l.id === listId)) {
      const playbookId = params.get("playbook") || "";
      const runId = params.get("run") || "";
      const playbookName =
        params.get("playbook_name") ||
        presetName ||
        "Playbook de retencao";
      const audienceName =
        params.get("audience") ||
        contactLists.find((l) => l.id === listId)?.name ||
        "";
      const templateHint = params.get("template_hint") || "";
      const messageGoal = params.get("message_goal") || "";
      const guardrail = params.get("guardrail") || "";

      setAudienceMode("list");
      setSelectedListId(listId);
      if (presetName) setCampaignName(presetName);
      if (playbookId || runId || messageGoal || guardrail) {
        setRetentionContext({
          runId,
          playbookId,
          playbookName,
          audienceName,
          sourceListId: listId,
          templateHint,
          messageGoal,
          guardrail,
        });
        const prompt = [messageGoal, guardrail].filter(Boolean).join("\n");
        if (prompt) setCopyPrompt(prompt);
        if (templateHint) setTemplateSearch(templateHint);
      }
      setShowCreate(true);
      params.delete("list");
      params.delete("name");
      params.delete("run");
      params.delete("playbook");
      params.delete("playbook_name");
      params.delete("audience");
      params.delete("template_hint");
      params.delete("message_goal");
      params.delete("guardrail");
      const url = window.location.pathname + (params.toString() ? `?${params}` : "");
      window.history.replaceState({}, "", url);
    }
  }, [contactLists]);

  // Separate effect for monthly spend — only runs after config is loaded
  useEffect(() => {
    if (!workspace?.id || !configured) return;
    setSpendLoading(true);
    fetch("/api/crm/whatsapp/analytics?period=current_month", {
      headers: wsHeaders(),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) setMonthlySpend(data);
      })
      .catch(() => { /* silent */ })
      .finally(() => setSpendLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id, configured]);

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

  async function handleDeleteTemplate(name: string) {
    if (!confirm(`Excluir o template "${name}"? Esta acao e irreversivel.`)) return;
    try {
      const res = await fetch("/api/crm/whatsapp/templates/manage", {
        method: "DELETE",
        headers: wsHeaders(),
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setTemplates((prev) => prev.filter((t) => t.name !== name));
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(`Erro ao excluir: ${data.error || "erro desconhecido"}`);
      }
    } catch {
      setErrorMsg("Erro de rede ao excluir template.");
    }
  }

  async function handleCreateCampaign() {
    if (!selectedTemplate || !campaignName) return;
    if (audienceMode === "segment" && !selectedSegment) return;
    if (audienceMode === "list" && !selectedListId) return;
    setCreating(true);
    try {
      // Resolve contacts source: RFM segment OR custom contact list
      let rawContacts: Array<{ phone: string; name: string; variables?: Record<string, string> }> = [];
      let segmentFilter: Record<string, unknown> = {};

      if (audienceMode === "segment") {
        const rfmRes = await fetch("/api/crm/rfm", { headers: wsHeaders() });
        const rfmData = await rfmRes.json();
        const customers = (rfmData.customers || []).filter(
          (c: { segment: string; phone: string }) =>
            c.segment === selectedSegment && c.phone
        );
        rawContacts = customers.map((c: { phone: string; name: string }) => ({
          phone: c.phone,
          name: c.name || "",
        }));
        segmentFilter = { segment: selectedSegment };
      } else {
        const listRes = await fetch(`/api/crm/contact-lists/${selectedListId}`, {
          headers: wsHeaders(),
        });
        const listData = await listRes.json();
        if (!listRes.ok) {
          alert(listData.error || "Falha ao ler lista.");
          setCreating(false);
          return;
        }
        const listContacts = (listData.list?.contacts || []) as Array<{
          phone?: string;
          name?: string;
          variables?: Record<string, string>;
        }>;
        rawContacts = listContacts
          .filter((c) => c.phone)
          .map((c) => ({ phone: c.phone!, name: c.name || "", variables: c.variables || {} }));
        const autoSegment = listData.list?.auto_segment as {
          type?: string;
          run_id?: string;
          playbook_id?: string;
          playbook_name?: string;
          role?: string;
          holdout_pct?: number;
        } | null;
        segmentFilter = { contact_list_id: selectedListId, contact_list_name: listData.list?.name };
        if (autoSegment?.type === "retention_playbook") {
          segmentFilter.playbook_run_id = autoSegment.run_id;
          segmentFilter.playbook_id = autoSegment.playbook_id;
          segmentFilter.playbook_name = autoSegment.playbook_name;
          segmentFilter.playbook_audience_role = autoSegment.role;
          segmentFilter.holdout_pct = autoSegment.holdout_pct;
        }
        if (retentionContext && retentionContext.sourceListId === selectedListId) {
          segmentFilter.playbook_run_id = segmentFilter.playbook_run_id || retentionContext.runId;
          segmentFilter.playbook_id = segmentFilter.playbook_id || retentionContext.playbookId;
          segmentFilter.playbook_name = segmentFilter.playbook_name || retentionContext.playbookName;
          segmentFilter.playbook_context = {
            template_hint: retentionContext.templateHint,
            message_goal: retentionContext.messageGoal,
            guardrail: retentionContext.guardrail,
          };
        }
      }

      // Resolve exclusion list (se houver) — fetcha contatos e monta Set de phones normalizados
      const excludeSet = new Set<string>();
      if (excludeListId) {
        try {
          const exRes = await fetch(`/api/crm/contact-lists/${excludeListId}`, { headers: wsHeaders() });
          const exData = await exRes.json();
          if (exRes.ok) {
            const exContacts = (exData.list?.contacts || []) as Array<{ phone?: string }>;
            for (const c of exContacts) {
              if (c.phone) excludeSet.add(c.phone.replace(/\D/g, ""));
            }
            segmentFilter.exclude_contact_list_id = excludeListId;
            segmentFilter.exclude_contact_list_name = exData.list?.name;
          }
        } catch {
          // segue o jogo sem exclusão se falhar
        }
      }

      // Aplica exclusão antes de formatar (compara por digits only)
      const afterExclusion = excludeSet.size > 0
        ? rawContacts.filter((c) => !excludeSet.has(c.phone.replace(/\D/g, "")))
        : rawContacts;

      // Format phone numbers and build contacts list
      const contacts = afterExclusion.map((c) => ({
        phone: formatPhone(c.phone),
        name: c.name || "",
        variables: Object.fromEntries(
          Object.entries(variableValues).map(([k, v]) => [
            k,
            resolveContactVariable(v, c),
          ])
        ),
      }));

      if (contacts.length === 0) {
        alert("Nenhum contato com telefone encontrado nesta audiência (após exclusão).");
        setCreating(false);
        return;
      }

      const scheduledAt = scheduleEnabled
        ? new Date(`${scheduledDate}T${scheduledTime}:00-03:00`).toISOString()
        : undefined;

      // Create campaign
      const res = await fetch("/api/crm/whatsapp/campaigns", {
        method: "POST",
        headers: wsHeaders(),
        body: JSON.stringify({
          name: campaignName,
          templateId: selectedTemplate.id,
          segmentFilter,
          variableValues,
          contacts,
          cooldownDays,
          scheduled_at: scheduledAt,
          requires_approval: requiresApproval,
          save_as_draft: saveAsDraft,
        }),
      });
      const data = await res.json();

      if (data.campaign) {
        // Só acelera o /send pra campanhas em 'queued'. Draft,
        // pending_approval e scheduled ficam aguardando.
        if (data.campaign.status === "queued") {
          await fetch(`/api/crm/whatsapp/campaigns/${data.campaign.id}/send`, {
            method: "POST",
            headers: wsHeaders(),
          });
        }
        setShowCreate(false);
        resetCreateForm();
        fetchCampaigns();
      }
    } catch {
      alert("Erro ao criar campanha.");
    }
    setCreating(false);
  }

  async function approveCampaign(id: string) {
    setApprovalBusyId(id);
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/crm/whatsapp/campaigns/${id}/approve`, {
        method: "POST",
        headers: wsHeaders(),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErrorMsg(d.error ?? "Falha ao aprovar campanha.");
        return;
      }
      await fetchCampaigns();
    } finally {
      setApprovalBusyId(null);
    }
  }

  async function rejectCampaign(id: string) {
    const reason = window.prompt("Motivo da rejeição (opcional):") ?? "";
    if (reason === null) return;
    setApprovalBusyId(id);
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/crm/whatsapp/campaigns/${id}/reject`, {
        method: "POST",
        headers: wsHeaders(),
        body: JSON.stringify({ reason }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErrorMsg(d.error ?? "Falha ao rejeitar campanha.");
        return;
      }
      await fetchCampaigns();
    } finally {
      setApprovalBusyId(null);
    }
  }

  function resetCreateForm() {
    setCreateStep(1);
    setCampaignName("");
    setSelectedTemplate(null);
    setAudienceMode("segment");
    setSelectedSegment("");
    setSelectedListId("");
    setExcludeListId("");
    setVariableValues({});
    setRequiresApproval(false);
    setSaveAsDraft(false);
    setScheduleEnabled(false);
    setRetentionContext(null);
    setCopyPrompt("");
    setCopyLoading(false);
  }

  function openEdit(c: WaCampaign) {
    setEditingCampaign(c);
    setEditName(c.name);
    if (c.scheduled_at) {
      const d = new Date(c.scheduled_at);
      const pad = (n: number) => String(n).padStart(2, "0");
      setEditDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
      setEditTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
      setEditScheduleEnabled(true);
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setEditDate(tomorrow.toISOString().slice(0, 10));
      setEditTime("09:00");
      setEditScheduleEnabled(false);
    }
    // Variáveis do template: começa com o que a campanha tem; se vazio,
    // inicializa cada variável do template com string vazia.
    const tpl = c.template_id ? templates.find((t) => t.id === c.template_id) : null;
    const tplVars: string[] = [];
    if (tpl) {
      for (const comp of tpl.components) {
        if (comp.text) {
          const matches = comp.text.match(/\{\{(\d+)\}\}/g);
          if (matches) for (const m of matches) if (!tplVars.includes(m)) tplVars.push(m);
        }
      }
    }
    const existing = c.variable_values || {};
    const next: Record<string, string> = {};
    for (const v of tplVars) next[v] = existing[v] ?? "";
    setEditVariableValues(next);
  }

  function getEditingTemplate(): WaTemplate | null {
    if (!editingCampaign?.template_id) return null;
    return templates.find((t) => t.id === editingCampaign.template_id) || null;
  }

  function getEditTemplateVars(): string[] {
    const tpl = getEditingTemplate();
    if (!tpl) return [];
    const vars: string[] = [];
    for (const comp of tpl.components) {
      if (comp.text) {
        const matches = comp.text.match(/\{\{(\d+)\}\}/g);
        if (matches) for (const m of matches) if (!vars.includes(m)) vars.push(m);
      }
    }
    return vars.sort();
  }

  function getEditBodyPreview(): string {
    const tpl = getEditingTemplate();
    if (!tpl) return "";
    const body = tpl.components.find((c) => c.type === "BODY");
    let text = body?.text || "";
    for (const [k, v] of Object.entries(editVariableValues)) {
      text = text.replace(k, v || k);
    }
    return text;
  }

  async function submitEdit() {
    if (!editingCampaign) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setErrorMsg("Nome não pode ser vazio.");
      return;
    }
    const isDraft = editingCampaign.status === "draft";
    let scheduledIso: string | null | undefined;
    if (editScheduleEnabled) {
      const when = new Date(`${editDate}T${editTime}:00-03:00`);
      if (Number.isNaN(when.getTime())) {
        setErrorMsg("Data/hora inválida.");
        return;
      }
      if (!isDraft && when.getTime() <= Date.now()) {
        setErrorMsg("Pra campanha agendada, a data precisa estar no futuro.");
        return;
      }
      scheduledIso = when.toISOString();
    } else if (isDraft) {
      // rascunho sem data prevista
      scheduledIso = null;
    } else {
      // não-draft não pode ficar sem data
      setErrorMsg("Campanha agendada precisa de data prevista.");
      return;
    }
    setEditBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/crm/whatsapp/campaigns/${editingCampaign.id}`, {
        method: "PATCH",
        headers: wsHeaders(),
        body: JSON.stringify({
          action: "update",
          name: trimmed,
          scheduled_at: scheduledIso,
          variable_values: editVariableValues,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error ?? "Falha ao salvar edição.");
        return;
      }
      setEditingCampaign(null);
      await fetchCampaigns();
    } finally {
      setEditBusy(false);
    }
  }

  async function deleteCampaign(c: WaCampaign) {
    const label = c.status === "draft" ? "rascunho" : "campanha agendada";
    if (!confirm(`Excluir este ${label} "${c.name}"? Esta ação é irreversível.`)) return;
    setDeleteBusyId(c.id);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/crm/whatsapp/campaigns/${c.id}`, {
        method: "DELETE",
        headers: wsHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error ?? "Falha ao excluir.");
        return;
      }
      await fetchCampaigns();
    } finally {
      setDeleteBusyId(null);
    }
  }

  async function activateDraft(id: string) {
    setActivateBusyId(id);
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/crm/whatsapp/campaigns/${id}/activate`, {
        method: "POST",
        headers: wsHeaders(),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErrorMsg(d.error ?? "Falha ao ativar rascunho.");
        return;
      }
      // Se foi pra queued (sem agendamento futuro), acelera o disparo.
      if (d.status === "queued") {
        await fetch(`/api/crm/whatsapp/campaigns/${id}/send`, {
          method: "POST",
          headers: wsHeaders(),
        });
      }
      await fetchCampaigns();
    } finally {
      setActivateBusyId(null);
    }
  }

  async function handleAddExclusion() {
    if (!newExcPhone.trim()) return;
    setAddingExclusion(true);
    try {
      const res = await fetch("/api/crm/whatsapp/exclusions", {
        method: "POST",
        headers: wsHeaders(),
        body: JSON.stringify({
          phone: newExcPhone.trim(),
          contact_name: newExcName.trim() || undefined,
          reason: newExcReason,
          notes: newExcNotes.trim() || undefined,
        }),
      });
      if (res.ok) {
        setNewExcPhone("");
        setNewExcName("");
        setNewExcReason("manual");
        setNewExcNotes("");
        fetchExclusions();
      }
    } catch {
      // silent
    }
    setAddingExclusion(false);
  }

  async function handleRemoveExclusion(id: string) {
    try {
      await fetch("/api/crm/whatsapp/exclusions", {
        method: "DELETE",
        headers: wsHeaders(),
        body: JSON.stringify({ id }),
      });
      setExclusions((prev) => prev.filter((e) => e.id !== id));
    } catch {
      // silent
    }
  }

  function formatPhone(phone: string): string {
    // Remove non-numeric, ensure +55 prefix
    const clean = phone.replace(/\D/g, "");
    if (clean.startsWith("55")) return clean;
    return `55${clean}`;
  }

  function resolveContactVariable(
    value: string,
    contact: { name?: string; variables?: Record<string, string> }
  ): string {
    if (value === "{{nome}}") return contact.name || "";
    const match = value.match(/^\{\{([a-zA-Z0-9_]+)\}\}$/);
    if (!match) return value;
    return contact.variables?.[match[1]] ?? value;
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

  function getTemplateBodyText(template: WaTemplate): string {
    return template.components.find((c) => c.type === "BODY")?.text || "";
  }

  function getSuggestedTemplates(): WaTemplate[] {
    if (!retentionContext?.templateHint) return [];
    const terms = retentionContext.templateHint
      .toLowerCase()
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean);
    if (terms.length === 0) return [];

    return templates
      .filter((template) => template.status === "APPROVED")
      .map((template) => {
        const haystack = `${template.name} ${template.category} ${getTemplateBodyText(template)}`.toLowerCase();
        const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        return { template, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.template.name.localeCompare(b.template.name))
      .slice(0, 3)
      .map((item) => item.template);
  }

  async function handleGenerateCopy() {
    const vars = getTemplateVars();
    if (!workspace?.id || !selectedTemplate || vars.length === 0 || copyLoading) return;

    setCopyLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/crm/whatsapp/generate-copy", {
        method: "POST",
        headers: wsHeaders(),
        body: JSON.stringify({
          campaignName: campaignName.trim(),
          templateBody: getTemplateBodyText(selectedTemplate),
          variables: vars,
          userPrompt: copyPrompt.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error || "Falha ao gerar variaveis com IA.");
        return;
      }
      if (data.values && Object.keys(data.values).length > 0) {
        setVariableValues((prev) => ({ ...prev, ...data.values }));
      }
    } catch (err) {
      setErrorMsg(`Erro ao gerar copy: ${err instanceof Error ? err.message : "desconhecido"}`);
    } finally {
      setCopyLoading(false);
    }
  }

  // --- Render ---

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
      draft: { variant: "outline", label: "Rascunho" },
      pending_approval: { variant: "outline", label: "Aguardando aprovação" },
      queued: { variant: "secondary", label: "Na fila" },
      scheduled: { variant: "secondary", label: "Agendada" },
      sending: { variant: "default", label: "Enviando" },
      completed: { variant: "default", label: "Concluida" },
      failed: { variant: "destructive", label: "Falhou" },
      cancelled: { variant: "destructive", label: "Cancelada" },
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
        <div className="flex items-center gap-2">
          <ShieldOff className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Nao perturbe:</span>
          <Select
            value={String(cooldownDays)}
            onValueChange={(v) => setCooldownDays(Number(v))}
          >
            <SelectTrigger className="w-[100px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Desligado</SelectItem>
              <SelectItem value="3">3 dias</SelectItem>
              <SelectItem value="7">7 dias</SelectItem>
              <SelectItem value="14">14 dias</SelectItem>
              <SelectItem value="30">30 dias</SelectItem>
              <SelectItem value="60">60 dias</SelectItem>
              <SelectItem value="90">90 dias</SelectItem>
            </SelectContent>
          </Select>
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

      {retentionContext && (
        <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Medicao por playbook
                </Badge>
                <span className="text-sm font-semibold">{retentionContext.playbookName}</span>
                {retentionContext.runId && (
                  <span className="text-xs text-muted-foreground">
                    run {retentionContext.runId.slice(0, 8)}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Lista de tratamento selecionada:{" "}
                <span className="font-medium text-foreground">
                  {retentionContext.audienceName || "lista do playbook"}
                </span>
                . O holdout fica fora do disparo para medir lift, receita e margem incremental.
              </p>
              {retentionContext.messageGoal && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Direcao da mensagem: {retentionContext.messageGoal}
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                setRetentionContext(null);
                setCopyPrompt("");
              }}
            >
              <X className="h-3.5 w-3.5" />
              Limpar contexto
            </Button>
          </div>
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
          <TabsTrigger value="exclusions" className="gap-1.5">
            <ShieldOff className="h-4 w-4" /> Exclusoes
          </TabsTrigger>
        </TabsList>

        {/* ==================== CAMPAIGNS TAB ==================== */}
        <TabsContent value="campaigns" className="space-y-4">
          {/* Monthly Spend Card */}
          {monthlySpend && (
            <Card className="border-blue-500/20 bg-blue-500/5">
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      Gasto WhatsApp — Mes Atual
                      {monthlySpend.totalUsd === 0 && monthlySpend.breakdown.length === 0 && !monthlySpend.templateMetrics && (
                        <span className="ml-2 text-amber-500">(estimado)</span>
                      )}
                      {monthlySpend.source === "template_analytics" && (
                        <span className="ml-2 text-blue-500">(via Template Analytics)</span>
                      )}
                    </p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold">
                        {(() => {
                          // If both APIs returned 0, show estimate from campaigns
                          if (monthlySpend.totalUsd === 0 && !monthlySpend.templateMetrics) {
                            const thisMonth = new Date();
                            const monthStart = new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1);
                            const totalSent = campaigns
                              .filter((c) => new Date(c.started_at || c.created_at) >= monthStart)
                              .reduce((sum, c) => sum + (c.sent_count || 0), 0);
                            const estBrl = totalSent * (campaigns[0]?.message_cost_usd || 0.0625) * (campaigns[0]?.exchange_rate || 5.80);
                            return `~R$ ${estBrl.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
                          }
                          return `R$ ${monthlySpend.totalBrl.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
                        })()}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {(() => {
                          if (monthlySpend.totalUsd === 0 && !monthlySpend.templateMetrics) {
                            const thisMonth = new Date();
                            const monthStart = new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1);
                            const totalSent = campaigns
                              .filter((c) => new Date(c.started_at || c.created_at) >= monthStart)
                              .reduce((sum, c) => sum + (c.sent_count || 0), 0);
                            const estUsd = totalSent * (campaigns[0]?.message_cost_usd || 0.0625);
                            return `(~US$ ${estUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })})`;
                          }
                          return `(US$ ${monthlySpend.totalUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })})`;
                        })()}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-4 text-xs">
                    {/* Show pricing_analytics breakdown if available */}
                    {monthlySpend.breakdown
                      .filter((b) => b.volume > 0)
                      .map((b, i) => (
                        <div key={i} className="text-center">
                          <div className="font-semibold">
                            {b.volume.toLocaleString("pt-BR")}
                          </div>
                          <div className="text-muted-foreground">
                            {b.category === "MARKETING" ? "Marketing" :
                             b.category === "UTILITY" ? "Utility" :
                             b.category === "AUTHENTICATION" ? "Auth" : b.category}
                            {b.type !== "REGULAR" && (
                              <span className="text-green-600 ml-1">
                                {b.type === "FREE_CUSTOMER_SERVICE" ? "(gratis CSW)" : "(gratis FEP)"}
                              </span>
                            )}
                          </div>
                          <div className="text-muted-foreground">
                            R$ {b.costBrl.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </div>
                        </div>
                      ))}
                    {/* Show template metrics if from fallback */}
                    {monthlySpend.templateMetrics && monthlySpend.templateMetrics.length > 0 && (
                      <>
                        <div className="text-center">
                          <div className="font-semibold">
                            {monthlySpend.templateMetrics.reduce((s, m) => s + m.sent, 0).toLocaleString("pt-BR")}
                          </div>
                          <div className="text-muted-foreground">Enviadas</div>
                        </div>
                        <div className="text-center">
                          <div className="font-semibold">
                            {monthlySpend.templateMetrics.reduce((s, m) => s + m.delivered, 0).toLocaleString("pt-BR")}
                          </div>
                          <div className="text-muted-foreground">Entregues</div>
                        </div>
                        <div className="text-center">
                          <div className="font-semibold">
                            {monthlySpend.templateMetrics.reduce((s, m) => s + m.read, 0).toLocaleString("pt-BR")}
                          </div>
                          <div className="text-muted-foreground">Lidas</div>
                        </div>
                      </>
                    )}
                    {/* Show estimate info when both APIs returned 0 */}
                    {monthlySpend.totalUsd === 0 && monthlySpend.breakdown.length === 0 && !monthlySpend.templateMetrics && campaigns.length > 0 && (
                      <div className="text-center">
                        <div className="font-semibold">
                          {campaigns
                            .filter((c) => {
                              const thisMonth = new Date();
                              const monthStart = new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1);
                              return new Date(c.started_at || c.created_at) >= monthStart;
                            })
                            .reduce((sum, c) => sum + (c.sent_count || 0), 0)
                            .toLocaleString("pt-BR")}
                        </div>
                        <div className="text-muted-foreground">Msgs este mes</div>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {spendLoading && !monthlySpend && (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando gastos...
            </div>
          )}

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

                {retentionContext && (
                  <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">Playbook CRM</Badge>
                      <span className="font-semibold">{retentionContext.playbookName}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {retentionContext.guardrail ||
                        "Use a lista de tratamento. O holdout fica sem disparo para medir resultado incremental."}
                    </p>
                    {retentionContext.templateHint && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Procure um template aprovado relacionado a{" "}
                        <span className="font-medium text-foreground">
                          {retentionContext.templateHint}
                        </span>
                        .
                      </p>
                    )}
                  </div>
                )}

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
                      <Label>Audiência</Label>
                      <div className="flex gap-1 mb-2 text-xs">
                        <button
                          type="button"
                          onClick={() => setAudienceMode("segment")}
                          className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                            audienceMode === "segment"
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                          }`}
                        >
                          Segmento RFM
                        </button>
                        <button
                          type="button"
                          onClick={() => setAudienceMode("list")}
                          className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                            audienceMode === "list"
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                          }`}
                        >
                          Lista personalizada (CSV)
                        </button>
                      </div>
                      {audienceMode === "segment" ? (
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
                      ) : (
                        <>
                          <Select value={selectedListId} onValueChange={setSelectedListId}>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecionar lista..." />
                            </SelectTrigger>
                            <SelectContent>
                              {contactLists.length === 0 ? (
                                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                  Nenhuma lista. Crie em /crm/listas.
                                </div>
                              ) : (
                                contactLists.map((l) => (
                                  <SelectItem
                                    key={l.id}
                                    value={l.id}
                                    disabled={l.phone_count === 0}
                                  >
                                    {l.name} ({l.phone_count} com telefone / {l.total_count} total)
                                  </SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>
<p className="text-[11px] text-muted-foreground mt-1">
                            Listas uploadadas em <a href="/crm/listas" className="underline">/crm/listas</a>. Só contatos com telefone vão pra fila.
                          </p>
                        </>
                      )}
                    </div>

                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Excluir lista (opcional)
                      </Label>
                      <Select
                        value={excludeListId || "__none__"}
                        onValueChange={(v) => setExcludeListId(v === "__none__" ? "" : v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Não excluir nenhuma..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Não excluir</SelectItem>
                          {contactLists.map((l) => (
                            <SelectItem
                              key={l.id}
                              value={l.id}
                              disabled={l.phone_count === 0}
                            >
                              {l.name} ({l.phone_count} com telefone)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Os telefones dessa lista não vão receber a campanha.
                      </p>
                    </div>

                    <div>
                      <Label>Template</Label>
                      {getSuggestedTemplates().length > 0 && (
                        <div className="mb-2 grid gap-2">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Sugestao pelo playbook
                          </p>
                          {getSuggestedTemplates().map((template) => (
                            <button
                              key={template.id}
                              type="button"
                              onClick={() => {
                                setSelectedTemplate(template);
                                setVariableValues({});
                              }}
                              className={`rounded-md border p-2 text-left transition-colors ${
                                selectedTemplate?.id === template.id
                                  ? "border-primary bg-primary/5"
                                  : "border-border hover:border-primary/40 hover:bg-muted/40"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium">{template.name}</span>
                                <Badge variant="outline" className="text-[10px]">
                                  {template.language}
                                </Badge>
                              </div>
                              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                {getTemplateBodyText(template) || "Sem corpo"}
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
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
                      disabled={
                        !campaignName ||
                        !selectedTemplate ||
                        (audienceMode === "segment" ? !selectedSegment : !selectedListId)
                      }
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

                    <div className="rounded-md border border-sky-500/20 bg-sky-500/5 p-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-sky-500" />
                        <p className="text-sm font-medium">Assistente de variaveis</p>
                      </div>
                      <Textarea
                        value={copyPrompt}
                        onChange={(e) => setCopyPrompt(e.target.value)}
                        placeholder="Ex: lembrar saldo de cashback e chamar para recompra sem desconto extra"
                        className="mt-2 min-h-[72px] text-sm"
                        disabled={copyLoading}
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={handleGenerateCopy}
                          disabled={copyLoading || !selectedTemplate}
                        >
                          {copyLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                          Gerar com IA
                        </Button>
                        {retentionContext?.messageGoal && (
                          <span className="text-xs text-muted-foreground">
                            O prompt ja veio do playbook.
                          </span>
                        )}
                      </div>
                    </div>

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
                          <span className="text-muted-foreground">Audiência:</span>
                          <span className="font-medium">
                            {audienceMode === "segment"
                              ? SEGMENT_LABELS[selectedSegment] || selectedSegment
                              : contactLists.find((l) => l.id === selectedListId)?.name || "—"}
                          </span>
                        </div>
                        {retentionContext && (
                          <div className="flex justify-between gap-3">
                            <span className="text-muted-foreground">Playbook:</span>
                            <span className="text-right font-medium">
                              {retentionContext.playbookName}
                              {retentionContext.runId
                                ? ` · run ${retentionContext.runId.slice(0, 8)}`
                                : ""}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Template:</span>
                          <span className="font-medium">{selectedTemplate?.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Destinatarios:</span>
                          <span className="font-medium">
                            {audienceMode === "segment"
                              ? `${segments.find((s) => s.segment === selectedSegment)?.count || "?"} contatos`
                              : `${contactLists.find((l) => l.id === selectedListId)?.phone_count || 0} contatos`}
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

                    {/* Agendamento */}
                    <div className="space-y-2 border rounded-md p-4">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          Agendar para data específica
                        </Label>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={scheduleEnabled}
                          onClick={() => setScheduleEnabled((v) => !v)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors ${
                            scheduleEnabled
                              ? "bg-foreground border-foreground"
                              : "bg-card border-border"
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 mt-[2px] transform rounded-full bg-background transition ${
                              scheduleEnabled ? "translate-x-5" : "translate-x-[2px]"
                            }`}
                          />
                        </button>
                      </div>
                      {scheduleEnabled && (
                        <div className="flex gap-2 pt-1">
                          <Input
                            type="date"
                            value={scheduledDate}
                            onChange={(e) => setScheduledDate(e.target.value)}
                            className="h-9 text-xs flex-1"
                            min={new Date().toISOString().slice(0, 10)}
                          />
                          <Input
                            type="time"
                            value={scheduledTime}
                            onChange={(e) => setScheduledTime(e.target.value)}
                            className="h-9 text-xs w-28"
                            step={300}
                          />
                        </div>
                      )}
                    </div>

                    {/* Modo rascunho pessoal — guarda preparado pra ativar depois */}
                    <div className="space-y-2 border rounded-md p-4">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                          <FileEdit className="h-3.5 w-3.5" />
                          Salvar como rascunho
                        </Label>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={saveAsDraft}
                          onClick={() => setSaveAsDraft((v) => !v)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors ${
                            saveAsDraft
                              ? "bg-foreground border-foreground"
                              : "bg-card border-border"
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 mt-[2px] transform rounded-full bg-background transition ${
                              saveAsDraft ? "translate-x-5" : "translate-x-[2px]"
                            }`}
                          />
                        </button>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {saveAsDraft
                          ? "Nada vai pra Meta agora. A campanha fica como Rascunho com a data prevista acima (opcional). Quando você clicar em Ativar na lista de campanhas, ela vai pra Agendada (se a data ainda estiver no futuro) ou pra fila de envio."
                          : "Sem rascunho: a campanha vai direto pra fila/agenda definida acima."}
                      </p>
                    </div>

                    {/* Modo rascunho com aprovação */}
                    <div className="space-y-2 border rounded-md p-4">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Salvar como rascunho (precisa aprovação)
                        </Label>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={requiresApproval}
                          onClick={() => setRequiresApproval((v) => !v)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors ${
                            requiresApproval
                              ? "bg-foreground border-foreground"
                              : "bg-card border-border"
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 mt-[2px] transform rounded-full bg-background transition ${
                              requiresApproval ? "translate-x-5" : "translate-x-[2px]"
                            }`}
                          />
                        </button>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {requiresApproval
                          ? "Nada vai pra Meta agora. A campanha fica Aguardando aprovação na lista até alguém do time aprovar — aí dispara na data + hora marcadas acima (obrigatórias nesse modo)."
                          : "Envio direto: a campanha entra na fila e o cron dispara conforme o agendamento acima."}
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
                        disabled={creating || (requiresApproval && !scheduleEnabled)}
                      >
                        {creating ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : saveAsDraft ? (
                          <FileEdit className="h-4 w-4 mr-2" />
                        ) : requiresApproval ? (
                          <ShieldCheck className="h-4 w-4 mr-2" />
                        ) : scheduleEnabled ? (
                          <Clock className="h-4 w-4 mr-2" />
                        ) : (
                          <Send className="h-4 w-4 mr-2" />
                        )}
                        {saveAsDraft
                          ? scheduleEnabled
                            ? `Salvar rascunho (${scheduledDate} ${scheduledTime})`
                            : "Salvar rascunho"
                          : requiresApproval
                          ? "Enviar pra aprovação"
                          : scheduleEnabled
                          ? `Agendar ${scheduledDate} ${scheduledTime}`
                          : "Enviar Campanha"}
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
              {campaigns.map((c) => {
                const perf = perfData[c.id];
                return (
                  <Card key={c.id}>
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{c.name}</span>
                            {statusBadge(c.status)}
                            {c.scheduled_at && (c.status === "scheduled" || c.status === "draft" || c.status === "pending_approval") && (
                              <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-400">
                                <Clock className="h-3 w-3" />
                                {new Date(c.scheduled_at).toLocaleString("pt-BR", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Template: {c.wa_templates?.name || "—"} | Criada em{" "}
                            {new Date(c.created_at).toLocaleString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
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
                          {["draft", "scheduled", "queued", "pending_approval"].includes(c.status) && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="ml-2 gap-1.5"
                              onClick={() => openEdit(c)}
                              title="Editar nome e/ou data prevista"
                            >
                              <Pencil className="h-3.5 w-3.5" /> Editar
                            </Button>
                          )}
                          {["draft", "scheduled", "queued"].includes(c.status) && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-destructive hover:text-destructive"
                              disabled={deleteBusyId === c.id}
                              onClick={() => deleteCampaign(c)}
                              title="Excluir campanha (não pode ser desfeito)"
                            >
                              {deleteBusyId === c.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                              Excluir
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="ml-2 gap-1.5"
                            onClick={() => setDetailsCampaignId(c.id)}
                          >
                            <Eye className="h-3.5 w-3.5" /> Detalhes
                          </Button>
                        </div>
                      </div>

                      {c.status === "draft" && (() => {
                        const busy = activateBusyId === c.id;
                        const scheduledFuture =
                          c.scheduled_at && new Date(c.scheduled_at).getTime() > Date.now();
                        return (
                          <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-3 flex-wrap">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <FileEdit className="h-3.5 w-3.5" />
                              Rascunho — nada foi enviado ainda.
                              {c.scheduled_at && (
                                <span>
                                  {" "}Data prevista:{" "}
                                  {new Date(c.scheduled_at).toLocaleString("pt-BR", {
                                    day: "2-digit",
                                    month: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              )}
                            </div>
                            <div className="ml-auto flex items-center gap-2">
                              <Button
                                size="sm"
                                className="h-7 text-xs gap-1.5"
                                disabled={busy}
                                title={
                                  scheduledFuture
                                    ? "Ativar e deixar agendado pra data prevista"
                                    : "Ativar e enviar agora"
                                }
                                onClick={() => activateDraft(c.id)}
                              >
                                {busy ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Play className="h-3 w-3" />
                                )}
                                {scheduledFuture ? "Ativar agendamento" : "Ativar e enviar"}
                              </Button>
                            </div>
                          </div>
                        );
                      })()}

                      {c.status === "pending_approval" && (() => {
                        const busy = approvalBusyId === c.id;
                        return (
                          <div className="mt-3 pt-3 border-t border-amber-500/30 flex items-center gap-3 flex-wrap">
                            <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                              <ShieldCheck className="h-3.5 w-3.5" />
                              Aguardando aprovação
                              {c.submitted_at && (
                                <span className="text-muted-foreground">
                                  · submetido{" "}
                                  {new Date(c.submitted_at).toLocaleString("pt-BR", {
                                    day: "2-digit",
                                    month: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              )}
                            </div>
                            <div className="ml-auto flex items-center gap-2">
                              <Button
                                size="sm"
                                className="h-7 text-xs gap-1.5"
                                disabled={busy}
                                title="Aprovar e disparar"
                                onClick={() => approveCampaign(c.id)}
                              >
                                {busy ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-3 w-3" />
                                )}
                                Aprovar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1.5 text-destructive hover:text-destructive"
                                disabled={busy}
                                onClick={() => rejectCampaign(c.id)}
                              >
                                <ShieldX className="h-3 w-3" />
                                Rejeitar
                              </Button>
                            </div>
                          </div>
                        );
                      })()}

                      {c.status === "cancelled" && c.rejection_reason && (
                        <div className="mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground">
                          <span className="font-medium text-red-500">
                            Motivo da rejeição:
                          </span>{" "}
                          {c.rejection_reason}
                        </div>
                      )}

                      {/* Performance / Attribution */}
                      {perf && (
                        <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-5 text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Conversoes:</span>
                            <span className="font-semibold text-green-600">{perf.conversions} vendas</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Receita:</span>
                            <span className="font-semibold text-green-600">
                              R$ {perf.attributed_revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Custo:</span>
                            <span className="font-semibold">
                              R$ {(perf.real_cost_brl ?? perf.total_cost_brl).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                            </span>
                            {perf.cost_source === "meta_api" && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-blue-600 border-blue-600/30">Meta</Badge>
                            )}
                            {perf.cost_source === "estimated" && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-muted-foreground">Est.</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">ROI:</span>
                            {(() => {
                              const costBrl = perf.real_cost_brl ?? perf.total_cost_brl;
                              const roi = costBrl > 0
                                ? Math.round(((perf.attributed_revenue - costBrl) / costBrl) * 100)
                                : 0;
                              return (
                                <span className={`font-semibold ${roi >= 0 ? "text-green-600" : "text-red-600"}`}>
                                  {roi.toLocaleString("pt-BR")}%
                                </span>
                              );
                            })()}
                          </div>
                          <div className="flex items-center gap-1.5 ml-auto">
                            <span className="text-muted-foreground">
                              Janela: {perf.window_days}d {perf.window_active ? "(ativa)" : "(encerrada)"}
                            </span>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
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
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <p className="text-sm text-muted-foreground">
                {templates.length} template(s) sincronizado(s)
                {templates.length > 0 && (
                  <span className="ml-2">
                    — {templates.filter((t) => t.status === "APPROVED").length} aprovado(s),{" "}
                    {templates.filter((t) => t.status === "PENDING").length} em analise
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setShowTemplateCreate(true)}
                disabled={!configured}
                size="sm"
              >
                <Plus className="h-4 w-4 mr-1" />
                Criar Template
              </Button>
              <Button
                onClick={handleSyncTemplates}
                disabled={syncingTemplates || !configured}
                variant="outline"
                size="sm"
              >
                {syncingTemplates ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                Sincronizar
              </Button>
            </div>
          </div>

          {/* Search + filter */}
          {templates.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  placeholder="Buscar por nome..."
                  className="pl-9 h-8 text-sm"
                />
              </div>
              <div className="flex items-center gap-1">
                {(["all", "APPROVED", "PENDING", "REJECTED"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setTemplateFilter(f)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      templateFilter === f
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                  >
                    {f === "all" ? "Todos" : f === "APPROVED" ? "Aprovados" : f === "PENDING" ? "Pendentes" : "Rejeitados"}
                  </button>
                ))}
              </div>
            </div>
          )}

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
              {templates
                .filter((t) => {
                  if (templateFilter !== "all" && t.status !== templateFilter) return false;
                  if (templateSearch && !t.name.toLowerCase().includes(templateSearch.toLowerCase())) return false;
                  return true;
                })
                .map((t) => {
                  const header = t.components.find((c) => c.type === "HEADER");
                  const body = t.components.find((c) => c.type === "BODY");
                  const footer = t.components.find((c) => c.type === "FOOTER");
                  const buttons = t.components.find((c) => c.type === "BUTTONS");
                  const lto = t.components.find((c) => c.type === "LIMITED_TIME_OFFER");
                  const carousel = t.components.find((c) => c.type === "CAROUSEL");
                  const vars = (body?.text || "").match(/\{\{\d+\}\}/g);

                  return (
                    <Card
                      key={t.id}
                      className="cursor-pointer hover:border-primary/40 transition-colors"
                      onClick={() => setPreviewTemplate(t)}
                    >
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{t.name}</span>
                              <Badge
                                variant={t.status === "APPROVED" ? "default" : t.status === "REJECTED" ? "destructive" : "secondary"}
                                className="gap-1"
                              >
                                {t.status === "APPROVED" && <CheckCircle2 className="h-3 w-3" />}
                                {t.status === "PENDING" && <Clock className="h-3 w-3" />}
                                {t.status === "REJECTED" && <AlertCircle className="h-3 w-3" />}
                                {t.status === "APPROVED" ? "Aprovado" : t.status === "PENDING" ? "Em analise" : t.status === "REJECTED" ? "Rejeitado" : t.status}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={t.category === "MARKETING"
                                  ? "border-purple-500/30 text-purple-400"
                                  : "border-sky-500/30 text-sky-400"
                                }
                              >
                                {t.category === "MARKETING" ? "Marketing" : "Utilidade"}
                              </Badge>
                              {lto && (
                                <Badge variant="outline" className="border-amber-500/30 text-amber-400 gap-1">
                                  <Timer className="h-3 w-3" /> Oferta Limitada
                                </Badge>
                              )}
                              {carousel && (
                                <Badge variant="outline" className="border-blue-500/30 text-blue-400 gap-1">
                                  <Layers className="h-3 w-3" /> Carrossel
                                </Badge>
                              )}
                            </div>
                            {/* Meta info row */}
                            <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                              <span>{t.language}</span>
                              {header?.format && (
                                <span className="flex items-center gap-1">
                                  {header.format === "IMAGE" && <Image className="h-3 w-3" />}
                                  {header.format === "VIDEO" && <Video className="h-3 w-3" />}
                                  {header.format === "DOCUMENT" && <FileText className="h-3 w-3" />}
                                  {header.format === "TEXT" ? "Header texto" : header.format === "IMAGE" ? "Imagem" : header.format === "VIDEO" ? "Video" : header.format === "DOCUMENT" ? "Documento" : header.format}
                                </span>
                              )}
                              {vars && vars.length > 0 && (
                                <span className="flex items-center gap-1">
                                  <Hash className="h-3 w-3" />
                                  {vars.length} variavel(is)
                                </span>
                              )}
                              {buttons?.buttons && buttons.buttons.length > 0 && (
                                <span className="flex items-center gap-1">
                                  <MousePointerClick className="h-3 w-3" />
                                  {buttons.buttons.length} botao(oes)
                                </span>
                              )}
                              {carousel && (
                                <span className="flex items-center gap-1">
                                  <Layers className="h-3 w-3" />
                                  {(carousel as unknown as { cards?: unknown[] }).cards?.length || 0} card(s)
                                </span>
                              )}
                              {footer?.text && (
                                <span className="truncate max-w-[150px]">Rodape: {footer.text}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={(e) => { e.stopPropagation(); setPreviewTemplate(t); }}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-700 hover:bg-red-500/10"
                              onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(t.name); }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        {/* Body snippet */}
                        {body?.text && (
                          <p className="text-xs mt-2 text-muted-foreground line-clamp-2">{body.text}</p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
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
                <Label>Phone Number ID (para enviar mensagens)</Label>
                <Input
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="Ex: 108594078879939"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Meta Business &gt; WhatsApp &gt; API Setup &gt; Phone number ID
                </p>
              </div>

              <div>
                <Label>WABA ID (para listar templates)</Label>
                <Input
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                  placeholder="Ex: 105607595847972"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  E o numero na URL do endpoint de templates: graph.facebook.com/v19.0/<strong>WABA_ID</strong>/message_templates
                </p>
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

        {/* ==================== EXCLUSIONS TAB ==================== */}
        <TabsContent value="exclusions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldOff className="h-5 w-5" />
                Lista de Exclusao
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Contatos nesta lista nunca receberao campanhas de WhatsApp. Use para opt-outs, reclamacoes ou pedidos de remocao.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add exclusion form */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                <div>
                  <Label>Telefone *</Label>
                  <Input
                    value={newExcPhone}
                    onChange={(e) => setNewExcPhone(e.target.value)}
                    placeholder="5562985955001"
                  />
                </div>
                <div>
                  <Label>Nome (opcional)</Label>
                  <Input
                    value={newExcName}
                    onChange={(e) => setNewExcName(e.target.value)}
                    placeholder="Nome do contato"
                  />
                </div>
                <div>
                  <Label>Motivo</Label>
                  <Select value={newExcReason} onValueChange={setNewExcReason}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="complaint">Reclamacao</SelectItem>
                      <SelectItem value="opt_out">Pediu para sair</SelectItem>
                      <SelectItem value="bounce">Numero invalido</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Observacoes (opcional)</Label>
                  <Input
                    value={newExcNotes}
                    onChange={(e) => setNewExcNotes(e.target.value)}
                    placeholder="Ex: Reclamou no SAC"
                  />
                </div>
                <Button
                  onClick={handleAddExclusion}
                  disabled={addingExclusion || !newExcPhone.trim()}
                >
                  {addingExclusion ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Adicionar
                </Button>
              </div>

              {/* Exclusions table */}
              {exclusionsLoading ? (
                <div className="text-center py-8 text-muted-foreground">Carregando...</div>
              ) : exclusions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ShieldOff className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p>Nenhum contato na lista de exclusao.</p>
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium">Telefone</th>
                        <th className="text-left px-4 py-2 font-medium">Nome</th>
                        <th className="text-left px-4 py-2 font-medium">Motivo</th>
                        <th className="text-left px-4 py-2 font-medium">Observacoes</th>
                        <th className="text-left px-4 py-2 font-medium">Data</th>
                        <th className="px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {exclusions.map((exc) => (
                        <tr key={exc.id} className="hover:bg-muted/30">
                          <td className="px-4 py-2 font-mono">{exc.phone}</td>
                          <td className="px-4 py-2">{exc.contact_name || "—"}</td>
                          <td className="px-4 py-2">
                            <Badge variant="outline" className="text-xs">
                              {exc.reason === "manual" && "Manual"}
                              {exc.reason === "complaint" && "Reclamacao"}
                              {exc.reason === "opt_out" && "Opt-out"}
                              {exc.reason === "bounce" && "Bounce"}
                              {!["manual", "complaint", "opt_out", "bounce"].includes(exc.reason) && exc.reason}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{exc.notes || "—"}</td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {new Date(exc.created_at).toLocaleDateString("pt-BR")}
                          </td>
                          <td className="px-4 py-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveExclusion(exc.id)}
                              className="text-red-500 hover:text-red-700 hover:bg-red-500/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                {exclusions.length} contato(s) na lista de exclusao
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ==================== TEMPLATE PREVIEW DIALOG ==================== */}
      <Dialog open={!!previewTemplate} onOpenChange={(open) => { if (!open) setPreviewTemplate(null); }}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              {previewTemplate?.name}
            </DialogTitle>
          </DialogHeader>

          {previewTemplate && (() => {
            const pt = previewTemplate;
            const pHeader = pt.components.find((c) => c.type === "HEADER");
            const pBody = pt.components.find((c) => c.type === "BODY");
            const pFooter = pt.components.find((c) => c.type === "FOOTER");
            const pButtons = pt.components.find((c) => c.type === "BUTTONS");
            const pLto = pt.components.find((c) => c.type === "LIMITED_TIME_OFFER");
            const pCarousel = pt.components.find((c) => c.type === "CAROUSEL") as unknown as { cards?: Array<{ components: Array<{ type: string; text?: string; format?: string; buttons?: Array<{ type: string; text?: string; url?: string; example?: string }> }> }> } | undefined;

            return (
              <div className="flex-1 overflow-y-auto space-y-4">
                {/* Meta badges */}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={pt.status === "APPROVED" ? "default" : pt.status === "REJECTED" ? "destructive" : "secondary"}
                    className="gap-1"
                  >
                    {pt.status === "APPROVED" && <CheckCircle2 className="h-3 w-3" />}
                    {pt.status === "PENDING" && <Clock className="h-3 w-3" />}
                    {pt.status === "REJECTED" && <AlertCircle className="h-3 w-3" />}
                    {pt.status === "APPROVED" ? "Aprovado" : pt.status === "PENDING" ? "Em analise" : pt.status === "REJECTED" ? "Rejeitado" : pt.status}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={pt.category === "MARKETING" ? "border-purple-500/30 text-purple-400" : "border-sky-500/30 text-sky-400"}
                  >
                    {pt.category === "MARKETING" ? "Marketing" : "Utilidade"}
                  </Badge>
                  <Badge variant="outline">{pt.language}</Badge>
                  {pLto && (
                    <Badge variant="outline" className="border-amber-500/30 text-amber-400 gap-1">
                      <Timer className="h-3 w-3" /> Oferta Limitada
                    </Badge>
                  )}
                  {pCarousel && (
                    <Badge variant="outline" className="border-blue-500/30 text-blue-400 gap-1">
                      <Layers className="h-3 w-3" /> Carrossel
                    </Badge>
                  )}
                </div>

                {/* Phone mockup */}
                <div className="mx-auto max-w-xs border-2 rounded-2xl overflow-hidden bg-[#e5ddd5]">
                  <div className="bg-[#075e54] text-white text-center py-2 text-xs font-medium">
                    Preview
                  </div>
                  <div className="p-3 space-y-1">
                    <div className="bg-white rounded-lg shadow-sm overflow-hidden max-w-[85%] text-gray-900">
                      {/* Header */}
                      {pHeader?.format === "IMAGE" && (
                        <div className="w-full h-32 bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center">
                          <Image className="h-8 w-8 text-gray-400" />
                        </div>
                      )}
                      {pHeader?.format === "VIDEO" && (
                        <div className="w-full h-32 bg-gray-800 flex items-center justify-center">
                          <Video className="h-8 w-8 text-white/60" />
                        </div>
                      )}
                      {pHeader?.format === "DOCUMENT" && (
                        <div className="w-full h-16 bg-gray-100 flex items-center justify-center gap-2 text-xs text-gray-500">
                          <FileText className="h-5 w-5" /> Documento
                        </div>
                      )}
                      {pHeader?.format === "TEXT" && pHeader.text && (
                        <p className="px-2 pt-2 text-sm font-semibold text-gray-900">{pHeader.text}</p>
                      )}

                      {/* LTO indicator */}
                      {pLto && (
                        <div className="px-2 pt-2 flex items-center gap-1">
                          <Timer className="h-3.5 w-3.5 text-amber-600" />
                          <span className="text-[11px] font-medium text-amber-600">Oferta com prazo</span>
                        </div>
                      )}

                      {/* Body */}
                      {pBody?.text && (
                        <p className="px-2 py-1.5 text-sm whitespace-pre-wrap text-gray-900">{pBody.text}</p>
                      )}

                      {/* Footer */}
                      {pFooter?.text && (
                        <p className="px-2 pb-1.5 text-[11px] text-gray-500">{pFooter.text}</p>
                      )}

                      {/* Buttons */}
                      {pButtons?.buttons && pButtons.buttons.length > 0 && (
                        <div className="border-t border-gray-200">
                          {pButtons.buttons.map((b, i) => (
                            <div key={i} className="text-center py-1.5 text-sm text-[#00a5f4] border-b border-gray-200 last:border-b-0 flex items-center justify-center gap-1">
                              {b.type === "COPY_CODE" && <Copy className="h-3.5 w-3.5" />}
                              {b.type === "URL" && <Link className="h-3.5 w-3.5" />}
                              {b.type === "PHONE_NUMBER" && <Phone className="h-3.5 w-3.5" />}
                              {b.type === "COPY_CODE" ? "Copiar codigo da oferta" : (b.text || "Botao")}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Carousel cards */}
                    {pCarousel?.cards && pCarousel.cards.length > 0 && (
                      <div className="flex gap-2 overflow-x-auto pb-1 mt-1 -mx-1 px-1">
                        {pCarousel.cards.map((card, ci) => {
                          const cHeader = card.components.find((c) => c.type === "HEADER");
                          const cBody = card.components.find((c) => c.type === "BODY");
                          const cButtons = card.components.find((c) => c.type === "BUTTONS");
                          return (
                            <div key={ci} className="bg-white rounded-lg shadow-sm overflow-hidden shrink-0 text-gray-900" style={{ width: "160px" }}>
                              {cHeader?.format === "IMAGE" ? (
                                <div className="w-full h-20 bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center">
                                  <Image className="h-5 w-5 text-gray-400" />
                                </div>
                              ) : cHeader?.format === "VIDEO" ? (
                                <div className="w-full h-20 bg-gray-800 flex items-center justify-center">
                                  <Video className="h-5 w-5 text-white/60" />
                                </div>
                              ) : (
                                <div className="w-full h-20 bg-gray-200 flex items-center justify-center">
                                  <Image className="h-5 w-5 text-gray-400" />
                                </div>
                              )}
                              {cBody?.text && (
                                <p className="px-1.5 py-1 text-[10px] leading-tight line-clamp-3 text-gray-900">{cBody.text}</p>
                              )}
                              {cButtons?.buttons && cButtons.buttons.length > 0 && (
                                <div className="border-t border-gray-200">
                                  {cButtons.buttons.map((b, bi) => (
                                    <div key={bi} className="text-center py-1 text-[10px] text-[#00a5f4] border-b border-gray-200 last:border-b-0">
                                      {b.text || "Botao"}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Template details */}
                <div className="space-y-2 text-sm">
                  <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Detalhes</p>
                  {pHeader?.format && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Header</span>
                      <span className="flex items-center gap-1">
                        {pHeader.format === "IMAGE" && <Image className="h-3.5 w-3.5" />}
                        {pHeader.format === "VIDEO" && <Video className="h-3.5 w-3.5" />}
                        {pHeader.format === "DOCUMENT" && <FileText className="h-3.5 w-3.5" />}
                        {pHeader.format}
                      </span>
                    </div>
                  )}
                  {pBody?.text && (() => {
                    const pVars = pBody.text.match(/\{\{\d+\}\}/g);
                    return pVars && pVars.length > 0 ? (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Variaveis</span>
                        <span>{pVars.length} — {pVars.join(", ")}</span>
                      </div>
                    ) : null;
                  })()}
                  {pButtons?.buttons && pButtons.buttons.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Botoes</span>
                      <span>{pButtons.buttons.length} — {pButtons.buttons.map((b) => b.type === "COPY_CODE" ? "Copiar Codigo" : b.type === "URL" ? "URL" : b.type === "QUICK_REPLY" ? "Resposta" : b.type === "PHONE_NUMBER" ? "Telefone" : b.type).join(", ")}</span>
                    </div>
                  )}
                  {pCarousel?.cards && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cards</span>
                      <span>{pCarousel.cards.length} cards</span>
                    </div>
                  )}
                  {pButtons?.buttons?.some((b) => b.type === "URL" && b.url) && (
                    <div>
                      <span className="text-muted-foreground text-xs">URLs:</span>
                      {pButtons.buttons.filter((b) => b.type === "URL" && b.url).map((b, i) => (
                        <p key={i} className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 mt-1 break-all font-mono">
                          {b.url}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2 border-t">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1"
                    onClick={() => { handleDeleteTemplate(pt.name); setPreviewTemplate(null); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Excluir
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    onClick={() => setPreviewTemplate(null)}
                  >
                    Fechar
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <TemplateCreateDialog
        open={showTemplateCreate}
        onOpenChange={setShowTemplateCreate}
        onCreated={() => handleSyncTemplates()}
      />

      <CampaignDetailsDialog
        campaignId={detailsCampaignId}
        workspaceId={workspace?.id || ""}
        onClose={() => setDetailsCampaignId(null)}
        onChanged={() => fetchCampaigns()}
      />

      {/* Edição inline de rascunho/agendamento */}
      <Dialog
        open={!!editingCampaign}
        onOpenChange={(open) => {
          if (!open) setEditingCampaign(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingCampaign?.status === "draft"
                ? "Editar rascunho"
                : editingCampaign?.status === "pending_approval"
                ? "Editar campanha aguardando aprovação"
                : "Editar agendamento"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                Nome
              </Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Nome da campanha"
              />
            </div>

            <div className="space-y-2 border rounded-md p-4">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Data prevista
                  {editingCampaign?.status !== "draft" && (
                    <span className="normal-case text-muted-foreground/70 ml-1">
                      (obrigatória)
                    </span>
                  )}
                </Label>
                {editingCampaign?.status === "draft" && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={editScheduleEnabled}
                    onClick={() => setEditScheduleEnabled((v) => !v)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors ${
                      editScheduleEnabled
                        ? "bg-foreground border-foreground"
                        : "bg-card border-border"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 mt-[2px] transform rounded-full bg-background transition ${
                        editScheduleEnabled ? "translate-x-5" : "translate-x-[2px]"
                      }`}
                    />
                  </button>
                )}
              </div>
              {(editingCampaign?.status !== "draft" || editScheduleEnabled) && (
                <div className="flex gap-2 pt-1">
                  <Input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="h-9 text-xs flex-1"
                    min={
                      editingCampaign?.status === "draft"
                        ? undefined
                        : new Date().toISOString().slice(0, 10)
                    }
                  />
                  <Input
                    type="time"
                    value={editTime}
                    onChange={(e) => setEditTime(e.target.value)}
                    className="h-9 text-xs w-28"
                    step={300}
                  />
                </div>
              )}
<p className="text-[11px] text-muted-foreground leading-relaxed">
                {editingCampaign?.status === "draft"
                  ? editScheduleEnabled
                    ? "Quando você ativar, a campanha vai pra Agendada se a data ainda estiver no futuro — senão entra direto na fila."
                    : "Sem data: ao ativar, vai direto pra fila de envio."
                  : "Mudar essa data reagenda o envio."}
              </p>
            </div>

            {getEditTemplateVars().length > 0 && (
              <div className="space-y-3 border rounded-md p-4">
                <div>
                  <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                    Variáveis do template
                  </Label>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    Use <code className="bg-muted px-1 rounded">{"{{nome}}"}</code> pra preencher com o nome do contato. As mensagens em fila vão ser atualizadas.
                  </p>
                </div>

                {getEditTemplateVars().map((v) => (
                  <div key={v} className="space-y-1.5">
                    <Label className="text-xs">{v}</Label>
                    <div className="flex gap-2">
                      <Input
                        value={editVariableValues[v] || ""}
                        onChange={(e) =>
                          setEditVariableValues((prev) => ({ ...prev, [v]: e.target.value }))
                        }
                        placeholder="Valor fixo ou {{nome}}"
                        className="h-8 text-sm"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0"
                        onClick={() =>
                          setEditVariableValues((prev) => ({ ...prev, [v]: "{{nome}}" }))
                        }
                      >
                        Nome
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="bg-muted/50 rounded p-3 text-xs">
                  <p className="font-medium mb-1 flex items-center gap-1.5">
                    <Eye className="h-3.5 w-3.5" /> Preview
                  </p>
                  <p className="whitespace-pre-wrap">{getEditBodyPreview()}</p>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setEditingCampaign(null)}
                disabled={editBusy}
              >
                Cancelar
              </Button>
              <Button className="flex-1" onClick={submitEdit} disabled={editBusy}>
                {editBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
