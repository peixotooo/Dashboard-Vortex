"use client";

// SuggestionDispatchDialog — multi-step wizard pra disparar uma sugestão.
// Cinco etapas tipo quiz:
//   1. Conteúdo  — revisão obrigatória do subject + headline + lead + CTA
//   2. Teste     — envia preview pro email do usuário (pode pular)
//   3. Audiência — segmento RFM sugerido + listas Locaweb
//   4. Agendar   — agora ou em data/hora futura
//   5. Revisar   — resumo de tudo + botão Disparar
//
// O shell compartilhado em DispatchWizardShell cuida do step indicator,
// navegação e Voltar/Próximo. Aqui ficamos com o conteúdo de cada step
// e a lógica de submit.

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Send,
  Loader2,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Target,
  Eye,
  Mail,
  ListChecks,
  FileText,
} from "lucide-react";
import type { EmailSuggestion } from "@/lib/email-templates/types";
import { TestSendCard } from "./test-send-card";
import { BalanceCard } from "./balance-card";
import { DispatchWizardShell, type WizardStep } from "./dispatch-wizard-shell";

interface LocawebList {
  id: string | number;
  name: string;
  contacts_count?: number;
}

interface Props {
  suggestion: EmailSuggestion | null;
  workspaceId: string;
  onClose: () => void;
}

const SLOT_LABEL: Record<number, string> = {
  1: "Best-seller",
  2: "Sem-giro",
  3: "Novidade",
};

export function SuggestionDispatchDialog({ suggestion, workspaceId, onClose }: Props) {
  const [stepIndex, setStepIndex] = useState(0);

  // Step 1: conteúdo (subject/headline/lead/CTA editáveis inline). Se
  // editar, "Próximo" trava — pra dispatch com edits o usuário precisa
  // salvar como rascunho (cria draft com a copy nova) e disparar de lá.
  const [subjectEdit, setSubjectEdit] = useState("");
  const [headlineEdit, setHeadlineEdit] = useState("");
  const [leadEdit, setLeadEdit] = useState("");
  const [ctaTextEdit, setCtaTextEdit] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveDraftError, setSaveDraftError] = useState<string | null>(null);

  // Step 2: test
  const [testSentTo, setTestSentTo] = useState<string | null>(null);

  // Step 3: audience
  const [lists, setLists] = useState<LocawebList[] | null>(null);
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set());
  const [useSegment, setUseSegment] = useState(false);

  // Provider ativo do workspace — define se a etapa de audiência usa
  // lista da Locaweb (fan-out lá) ou resolve cluster RFM pro iPORTO.
  const [provider, setProvider] = useState<"locaweb" | "iporto">("locaweb");

  // Step 4: schedule
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [scheduledTime, setScheduledTime] = useState("09:00");

  // submit
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    locaweb_message_id: string;
    scheduled?: string | null;
    materialized_segment?: { list_name: string; count: number } | null;
  } | null>(null);

  useEffect(() => {
    if (!suggestion) return;
    setStepIndex(0);
    setSubjectEdit(suggestion.copy?.subject ?? "");
    setHeadlineEdit(suggestion.copy?.headline ?? "");
    setLeadEdit(suggestion.copy?.lead ?? "");
    setCtaTextEdit(suggestion.copy?.cta_text ?? "");
    setSavingDraft(false);
    setSaveDraftError(null);
    setTestSentTo(null);
    setLists(null);
    setSelectedListIds(new Set());
    setUseSegment(false);
    setScheduleEnabled(false);
    setScheduledDate(new Date().toISOString().slice(0, 10));
    setScheduledTime("09:00");
    setError(null);
    setSuccess(null);
    setSubmitting(false);
  }, [suggestion]);

  // Carrega provider ativo logo quando o dialog abre — usado só pra
  // adaptar texto da success card. Audiência (listas + segmento) é
  // provider-agnostic.
  useEffect(() => {
    if (!suggestion) return;
    fetch("/api/crm/email-templates/provider", {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d: { provider?: "locaweb" | "iporto" }) => {
        setProvider(d?.provider === "iporto" ? "iporto" : "locaweb");
      })
      .catch(() => setProvider("locaweb"));
  }, [suggestion, workspaceId]);

  // Lazy-load listas pra escolha de audiência. As listas vivem na
  // Locaweb mesmo quando o provider de envio é iPORTO — a Locaweb é
  // usada como "audience storage" pelos dois fluxos (CRM grava lá; o
  // backend de dispatch resolve list_ids → recipients[] quando iPORTO).
  useEffect(() => {
    if (!suggestion) return;
    if (stepIndex < 2 || lists !== null) return;
    fetch("/api/crm/email-templates/locaweb/lists", {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.reason === "not_configured") {
          setError("Audiência ainda não configurada — verifique credenciais nas Configurações.");
          setLists([]);
        } else if (d.error) {
          setError(d.error);
          setLists([]);
        } else {
          setLists(d.lists ?? []);
        }
      })
      .catch((err) => {
        setError(`Falha ao carregar listas: ${(err as Error).message}`);
        setLists([]);
      });
  }, [suggestion, workspaceId, stepIndex, lists]);

  if (!suggestion) return null;

  const segmentLabel =
    (suggestion.target_segment_payload as { display_label?: string })
      ?.display_label ?? "—";
  const segmentSize =
    (suggestion.target_segment_payload as { estimated_size?: number })
      ?.estimated_size ?? null;

  const originalSubject = suggestion.copy?.subject ?? "";
  const originalHeadline = suggestion.copy?.headline ?? "";
  const originalLead = suggestion.copy?.lead ?? "";
  const originalCta = suggestion.copy?.cta_text ?? "";
  // Subject vai inline no disparo (subject_override); headline/lead/CTA
  // mexem no rendered_html, então só pegam se promover a rascunho.
  const isBodyDirty =
    headlineEdit.trim() !== originalHeadline.trim() ||
    leadEdit.trim() !== originalLead.trim() ||
    ctaTextEdit.trim() !== originalCta.trim();
  const isDirty =
    subjectEdit.trim() !== originalSubject.trim() || isBodyDirty;

  const close = () => {
    if (submitting) return;
    onClose();
  };

  // Salva tudo (copy editada + audiência + agenda) como rascunho pendente
  // de aprovação. Fluxo em 2 passos:
  //   1. POST /to-draft com copy_override → cria o draft com a copy nova
  //   2. POST /drafts/[draft_id]/dispatch com requires_approval=true e o
  //      payload completo (list_ids + scheduled_to) → draft fica em
  //      approval_state='pending_approval' aguardando outro usuário
  //      aprovar. Quando aprovar, o /approve dispara com o payload salvo.
  const saveAsDraftWithApproval = async () => {
    if (selectedListIds.size === 0 && !useSegment) {
      setSaveDraftError("Escolha ao menos uma lista ou ative o segmento sugerido.");
      return;
    }
    // requires_approval exige scheduled_to no /drafts/dispatch endpoint
    if (!scheduleEnabled) {
      setSaveDraftError(
        "Ative o agendamento (etapa anterior) — rascunho pra aprovação precisa ter data/hora de envio."
      );
      return;
    }

    setSavingDraft(true);
    setSaveDraftError(null);
    try {
      // 1. Cria o draft a partir da sugestão com a copy editada
      const r1 = await fetch(
        `/api/crm/email-templates/${suggestion.id}/to-draft`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-workspace-id": workspaceId,
          },
          body: JSON.stringify({
            copy_override: {
              subject: subjectEdit,
              headline: headlineEdit,
              lead: leadEdit,
              cta_text: ctaTextEdit,
            },
          }),
        }
      );
      const d1 = await r1.json();
      if (!r1.ok) throw new Error(d1.error ?? "Falha ao criar rascunho.");
      const draftId = d1?.draft?.id;
      if (!draftId) throw new Error("Rascunho criado sem id.");

      // 2. Salva audiência + agenda no draft com requires_approval
      const r2 = await fetch(
        `/api/crm/email-templates/drafts/${draftId}/dispatch`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-workspace-id": workspaceId,
          },
          body: JSON.stringify({
            list_ids: Array.from(selectedListIds),
            use_segment: useSegment,
            scheduled_to: `${scheduledDate}T${scheduledTime}:00-03:00`,
            suggestion_id: suggestion.id,
            utm_term: (suggestion.target_segment_payload as {
              display_label?: string;
            })?.display_label,
            requires_approval: true,
          }),
        }
      );
      const d2 = await r2.json();
      if (!r2.ok) throw new Error(d2.error ?? "Falha ao agendar rascunho.");

      // Redireciona pra página de rascunhos onde ficará "Pendente de aprovação"
      window.location.href = `/crm/email-templates/drafts`;
    } catch (err) {
      setSaveDraftError((err as Error).message);
    } finally {
      setSavingDraft(false);
    }
  };

  const toggleList = (id: string) => {
    setSelectedListIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const audienceCount =
    (lists ?? [])
      .filter((l) => selectedListIds.has(String(l.id)))
      .reduce((sum, l) => sum + (l.contacts_count ?? 0), 0) +
    (useSegment && segmentSize ? segmentSize : 0);

  const submit = async () => {
    if (selectedListIds.size === 0 && !useSegment) {
      setError("Escolha ao menos uma lista ou ative o segmento sugerido.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/crm/email-templates/${suggestion.id}/dispatch`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-workspace-id": workspaceId,
          },
          body: JSON.stringify({
            // Funciona pra ambos providers: Locaweb usa direto via
            // createMessage(list_ids); iPORTO resolve em recipients[]
            // server-side via getListContacts.
            list_ids: Array.from(selectedListIds),
            use_segment: useSegment,
            scheduled_to: scheduleEnabled
              ? `${scheduledDate}T${scheduledTime}:00-03:00`
              : undefined,
            utm_term: (suggestion.target_segment_payload as {
              display_label?: string;
            })?.display_label,
            // Subject editado vai junto. Headline/lead/CTA continuam
            // exigindo "Salvar como rascunho" porque já foram render.
            subject_override:
              subjectEdit.trim() !== originalSubject.trim()
                ? subjectEdit.trim()
                : undefined,
          }),
        }
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Falha ao disparar.");
      setSuccess({
        // Compat com o success card existente — pra iPORTO, devolvemos
        // o dispatch_id no campo locaweb_message_id (mesma card UI).
        locaweb_message_id: d.locaweb_message_id ?? d.dispatch_id ?? "",
        scheduled: d.scheduled_to,
        materialized_segment: d.materialized_segment ?? null,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // Suggestion summary card shown above every step for context.
  const SuggestionInfo = (
    <div className="text-xs flex items-start gap-2 p-3 border rounded bg-muted/30">
      <Inbox className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="font-medium truncate">
          {suggestion.product_snapshot.name}
        </div>
        <div className="text-[10px] text-muted-foreground">
          Slot {suggestion.slot} · {SLOT_LABEL[suggestion.slot]} · gerado em{" "}
          {suggestion.generated_for_date}
        </div>
      </div>
    </div>
  );

  // ── Step contents ──────────────────────────────────────────────────────
  const stepReview: WizardStep = {
    id: "review",
    label: "Conteúdo",
    // Subject editado vai inline no disparo (subject_override pro endpoint).
    // Headline/lead/CTA mexem em rendered_html, então só pegam se promover a
    // rascunho — "Salvar como rascunho" no último passo.
    canProceed: true,
    nextHint: isBodyDirty
      ? "Edits de corpo viram rascunho ao final do wizard"
      : undefined,
    content: (
      <>
        {SuggestionInfo}
        <div className="space-y-3 border rounded-md p-4">
          <div className="space-y-1">
            <label
              htmlFor="sug-subject"
              className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"
            >
              <Mail className="w-3 h-3" />
              Subject (linha de assunto)
            </label>
            <Input
              id="sug-subject"
              value={subjectEdit}
              onChange={(e) => setSubjectEdit(e.target.value)}
              className="text-sm font-medium"
              placeholder="Linha de assunto do e-mail"
            />
          </div>
          <div className="space-y-1 border-t pt-3">
            <label
              htmlFor="sug-headline"
              className="text-[10px] uppercase tracking-widest text-muted-foreground"
            >
              Headline
            </label>
            <Input
              id="sug-headline"
              value={headlineEdit}
              onChange={(e) => setHeadlineEdit(e.target.value)}
              className="text-sm"
              placeholder="Título principal"
            />
          </div>
          <div className="space-y-1 border-t pt-3">
            <label
              htmlFor="sug-lead"
              className="text-[10px] uppercase tracking-widest text-muted-foreground"
            >
              Texto principal (preview)
            </label>
            <Textarea
              id="sug-lead"
              value={leadEdit}
              onChange={(e) => setLeadEdit(e.target.value)}
              className="text-xs leading-relaxed min-h-[70px]"
              placeholder="Texto do corpo do e-mail"
            />
          </div>
          <div className="space-y-1 border-t pt-3">
            <label
              htmlFor="sug-cta"
              className="text-[10px] uppercase tracking-widest text-muted-foreground"
            >
              Botão de ação
            </label>
            <Input
              id="sug-cta"
              value={ctaTextEdit}
              onChange={(e) => setCtaTextEdit(e.target.value)}
              className="text-xs font-mono"
              placeholder="Aproveitar agora"
            />
          </div>
        </div>
        {isBodyDirty && (
          <div className="text-[11px] p-2.5 rounded border border-amber-300 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-100">
            Você editou headline/texto/CTA. Subject já vai aplicado no
            disparo, mas as outras edições só pegam se finalizar com{" "}
            <strong>Salvar como rascunho</strong> no último passo.
          </div>
        )}
      </>
    ),
  };

  const stepTest: WizardStep = {
    id: "test",
    label: "Teste",
    canProceed: true,
    nextLabel: testSentTo ? "Continuar" : "Pular teste",
    nextHint: !testSentTo ? "Recomendado: envie um teste pro seu email" : undefined,
    content: (
      <>
        {SuggestionInfo}
        <TestSendCard
          endpoint={`/api/crm/email-templates/${suggestion.id}/test-dispatch`}
          workspaceId={workspaceId}
          subjectOverride={subjectEdit}
          onSent={(email) => setTestSentTo(email)}
        />
      </>
    ),
  };

  const stepAudience: WizardStep = {
    id: "audience",
    label: "Audiência",
    canProceed: selectedListIds.size > 0 || useSegment,
    nextHint:
      selectedListIds.size === 0 && !useSegment
        ? "Selecione ao menos uma lista ou ative o segmento sugerido"
        : undefined,
    content: (
      <>
        {SuggestionInfo}
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground">
            Para quem enviar
          </Label>

          <button
            type="button"
            onClick={() => setUseSegment((v) => !v)}
            disabled={segmentSize == null || segmentSize === 0}
            className={`w-full flex items-center gap-2 p-3 text-left rounded-md border transition-colors disabled:opacity-50 ${
              useSegment
                ? "border-foreground bg-foreground/5"
                : "border-border hover:bg-muted/40"
            }`}
          >
            <div
              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                useSegment
                  ? "bg-foreground border-foreground text-background"
                  : "border-border"
              }`}
            >
              {useSegment && <CheckCircle2 className="w-3 h-3" />}
            </div>
            <Target className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium flex items-center gap-1.5">
                Segmento sugerido
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-normal">
                  RFM
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground truncate">
                {segmentLabel}
                {segmentSize != null && segmentSize > 0
                  ? ` · ~${segmentSize.toLocaleString("pt-BR")} contatos`
                  : " · sem snapshot RFM"}
              </div>
            </div>
          </button>

          <Label className="text-xs uppercase tracking-widest text-muted-foreground pt-2 block">
            Listas (criadas no CRM)
          </Label>
          {lists === null ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando...
            </div>
          ) : lists.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 border rounded">
              <AlertTriangle className="w-3.5 h-3.5" />
              Nenhuma lista. Use o segmento sugerido acima ou crie uma no CRM.
            </div>
          ) : (
            <div className="border rounded-md max-h-48 overflow-y-auto divide-y">
              {lists.map((l) => {
                const idStr = String(l.id);
                const sel = selectedListIds.has(idStr);
                return (
                  <button
                    key={idStr}
                    type="button"
                    onClick={() => toggleList(idStr)}
                    className={`w-full flex items-center gap-2 p-2.5 text-left hover:bg-muted/40 ${
                      sel ? "bg-foreground/5" : ""
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                        sel
                          ? "bg-foreground border-foreground text-background"
                          : "border-border"
                      }`}
                    >
                      {sel && <CheckCircle2 className="w-3 h-3" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{l.name}</div>
                      {l.contacts_count != null && (
                        <div className="text-[10px] text-muted-foreground">
                          {l.contacts_count.toLocaleString("pt-BR")} contatos
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <BalanceCard
          workspaceId={workspaceId}
          estimatedRecipients={audienceCount}
          provider={provider}
        />
      </>
    ),
  };

  const stepSchedule: WizardStep = {
    id: "schedule",
    label: "Agendar",
    canProceed: true,
    content: (
      <>
        {SuggestionInfo}
        <div className="space-y-3 border rounded-md p-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
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
          {scheduleEnabled ? (
            <div className="flex gap-2">
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
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Sem agendamento, dispara assim que você confirmar na próxima
              etapa.
            </p>
          )}
        </div>
      </>
    ),
  };

  const stepReview2: WizardStep = {
    id: "confirm",
    label: "Revisar",
    canProceed: selectedListIds.size > 0 || useSegment,
    extraAction: {
      label: savingDraft ? "Salvando..." : "Salvar como rascunho",
      onClick: saveAsDraftWithApproval,
      icon: <FileText className="w-3.5 h-3.5" />,
      variant: "outline",
      disabled: savingDraft || submitting,
      loading: savingDraft,
    },
    content: (
      <>
        <div className="space-y-3 border rounded-md p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <ListChecks className="w-3 h-3" />
            Resumo do disparo
          </div>
          <SummaryRow label="Subject" value={subjectEdit || originalSubject} mono />
          <SummaryRow
            label="Produto"
            value={suggestion.product_snapshot.name}
          />
          <SummaryRow
            label="Audiência"
            value={
              <>
                {useSegment && (
                  <div>
                    Segmento sugerido · {segmentLabel}
                    {segmentSize != null && (
                      <span className="text-muted-foreground">
                        {" "}
                        (~{segmentSize.toLocaleString("pt-BR")})
                      </span>
                    )}
                  </div>
                )}
                {Array.from(selectedListIds).map((id) => {
                  const l = lists?.find((x) => String(x.id) === id);
                  return (
                    <div key={id}>
                      Lista · {l?.name ?? id}
                      {l?.contacts_count != null && (
                        <span className="text-muted-foreground">
                          {" "}
                          ({l.contacts_count.toLocaleString("pt-BR")})
                        </span>
                      )}
                    </div>
                  );
                })}
                {!useSegment && selectedListIds.size === 0 && (
                  <span className="text-destructive">
                    Nenhuma audiência selecionada
                  </span>
                )}
              </>
            }
          />
          <SummaryRow
            label="Total estimado"
            value={`${audienceCount.toLocaleString("pt-BR")} contatos`}
          />
          <SummaryRow
            label="Quando"
            value={
              scheduleEnabled
                ? `${scheduledDate} às ${scheduledTime}`
                : "Agora (assim que confirmar)"
            }
          />
          <SummaryRow
            label="Teste enviado?"
            value={
              testSentTo ? (
                <span className="text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Sim, para {testSentTo}
                </span>
              ) : (
                <span className="text-amber-700 dark:text-amber-300 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Não — você pulou essa etapa
                </span>
              )
            }
          />
        </div>
        {error && (
          <div className="text-xs text-destructive p-2 border border-destructive/30 rounded bg-destructive/5">
            {error}
          </div>
        )}
        {saveDraftError && (
          <div className="text-xs text-destructive p-2 border border-destructive/30 rounded bg-destructive/5">
            {saveDraftError}
          </div>
        )}
        <div className="text-[11px] text-muted-foreground p-2.5 rounded border bg-muted/30">
          <strong>Disparar:</strong> envia agora (ou no horário agendado).
          <br />
          <strong>Salvar como rascunho:</strong> fica em /rascunhos com tudo
          pronto (produto + audiência + horário), aguardando aprovação.
          Aprovador pode ser você mesmo ou outro usuário — só dispara
          depois do clique em &quot;Aprovar&quot;. Exige agendamento ativo.
        </div>
      </>
    ),
  };

  const steps = [stepReview, stepTest, stepAudience, stepSchedule, stepReview2];

  return (
    <Dialog open={!!suggestion} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-xl">
        <DialogTitle className="flex items-center gap-2">
          <Send className="w-4 h-4" />
          Disparar sugestão
        </DialogTitle>

        {success ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 border border-emerald-300 bg-emerald-100 dark:bg-emerald-950 dark:border-emerald-700 rounded-md">
              <CheckCircle2 className="w-5 h-5 text-emerald-700 dark:text-emerald-300 shrink-0 mt-0.5" />
              <div className="text-xs">
                <div className="font-medium text-emerald-900 dark:text-emerald-100">
                  {success.scheduled
                    ? `Campanha agendada para ${success.scheduled}`
                    : provider === "iporto"
                      ? "Enviada à fila iPORTO — cron-dispatcher entrega"
                      : "Campanha enviada à Locaweb"}
                </div>
                <div className="text-muted-foreground mt-0.5">
                  {provider === "iporto" ? "Dispatch id" : "ID Locaweb"}:{" "}
                  <span className="font-mono">{success.locaweb_message_id}</span>
                </div>
                {success.materialized_segment && (
                  <div className="text-muted-foreground mt-1">
                    Segmento materializado em lista{" "}
                    <span className="font-mono">
                      {success.materialized_segment.list_name}
                    </span>{" "}
                    com{" "}
                    {success.materialized_segment.count.toLocaleString("pt-BR")}{" "}
                    contatos.
                  </div>
                )}
                <div className="text-muted-foreground mt-1">
                  Stats começam a aparecer no painel de relatórios em algumas
                  horas.
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={close}>
                Fechar
              </Button>
            </div>
          </div>
        ) : (
          <DispatchWizardShell
            steps={steps}
            currentIndex={stepIndex}
            onBack={() => setStepIndex((i) => Math.max(0, i - 1))}
            onNext={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))}
            onClose={close}
            onFinish={submit}
            isSubmitting={submitting}
            finishLabel={
              scheduleEnabled
                ? `Agendar ${scheduledDate} ${scheduledTime}`
                : "Disparar agora"
            }
            finishIcon={
              scheduleEnabled ? (
                <Calendar className="w-3.5 h-3.5" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[120px,1fr] gap-2 text-xs">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground self-start mt-0.5">
        {label}
      </div>
      <div className={mono ? "font-mono text-xs" : ""}>{value}</div>
    </div>
  );
}
