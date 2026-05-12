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

  // Step 1: review (just an explicit "li, está ok" toggle)
  const [reviewed, setReviewed] = useState(false);

  // Step 2: test
  const [testSentTo, setTestSentTo] = useState<string | null>(null);

  // Step 3: audience
  const [lists, setLists] = useState<LocawebList[] | null>(null);
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set());
  const [useSegment, setUseSegment] = useState(false);

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
    setReviewed(false);
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

  // Lazy-load Locaweb lists when we hit the audience step.
  useEffect(() => {
    if (!suggestion) return;
    if (stepIndex < 2 || lists !== null) return;
    fetch("/api/crm/email-templates/locaweb/lists", {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.reason === "not_configured") {
          setError("Locaweb ainda não configurada — abre o drawer 'Locaweb' no header.");
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

  const subject = suggestion.copy?.subject ?? "(sem subject)";
  const headline = suggestion.copy?.headline ?? "";
  const lead = suggestion.copy?.lead ?? "";
  const ctaText = suggestion.copy?.cta_text ?? "";

  const close = () => {
    if (submitting) return;
    onClose();
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
            list_ids: Array.from(selectedListIds),
            use_segment: useSegment,
            scheduled_to: scheduleEnabled
              ? `${scheduledDate}T${scheduledTime}:00-03:00`
              : undefined,
            utm_term: (suggestion.target_segment_payload as {
              display_label?: string;
            })?.display_label,
          }),
        }
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Falha ao disparar.");
      setSuccess({
        locaweb_message_id: d.locaweb_message_id,
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
    canProceed: reviewed,
    nextHint: !reviewed ? "Marque o checkbox pra continuar" : undefined,
    content: (
      <>
        {SuggestionInfo}
        <div className="space-y-3 border rounded-md p-4">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Mail className="w-3 h-3" />
              Subject (linha de assunto)
            </div>
            <div className="text-sm font-medium">{subject}</div>
          </div>
          {headline && (
            <div className="space-y-1 border-t pt-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Headline
              </div>
              <div className="text-sm">{headline}</div>
            </div>
          )}
          {lead && (
            <div className="space-y-1 border-t pt-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Texto principal (preview)
              </div>
              <div className="text-xs text-muted-foreground leading-relaxed">
                {lead}
              </div>
            </div>
          )}
          {ctaText && (
            <div className="space-y-1 border-t pt-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Botão de ação
              </div>
              <div className="text-xs font-mono">{ctaText}</div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setReviewed((v) => !v)}
          className={`w-full flex items-center gap-2 p-3 text-left rounded-md border transition-colors ${
            reviewed
              ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/10 dark:border-emerald-800"
              : "border-border hover:bg-muted/30"
          }`}
        >
          <div
            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
              reviewed
                ? "bg-emerald-600 border-emerald-600 text-white"
                : "border-border"
            }`}
          >
            {reviewed && <CheckCircle2 className="w-3 h-3" />}
          </div>
          <span className="text-xs">
            Li o subject e o conteúdo principal e está tudo correto.
          </span>
        </button>
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
            Listas Locaweb
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
    content: (
      <>
        <div className="space-y-3 border rounded-md p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <ListChecks className="w-3 h-3" />
            Resumo do disparo
          </div>
          <SummaryRow label="Subject" value={subject} mono />
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
                    : "Campanha enviada à Locaweb"}
                </div>
                <div className="text-muted-foreground mt-0.5">
                  ID Locaweb:{" "}
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
