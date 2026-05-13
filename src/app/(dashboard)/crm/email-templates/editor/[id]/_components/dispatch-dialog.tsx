"use client";

// DispatchDialog — wizard de 5 etapas pra disparar um draft do editor.
// Mesma estrutura da SuggestionDispatchDialog (etapas 1-5: Conteúdo /
// Teste / Listas / Agendar / Revisar) mas sem o passo de "segmento
// sugerido" porque drafts não vêm com cluster RFM atrelado.

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
  Mail,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import { TestSendCard } from "../../../components/test-send-card";
import { BalanceCard } from "../../../components/balance-card";
import {
  DispatchWizardShell,
  type WizardStep,
} from "../../../components/dispatch-wizard-shell";

interface LocawebList {
  id: string;
  name: string;
  contacts_count?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  draftId: string;
  workspaceId: string;
  draftName?: string;
  draftSubject?: string;
  /** Preview text (hidden text shown in inbox listings). */
  draftPreview?: string;
}

export function DispatchDialog({
  open,
  onClose,
  draftId,
  workspaceId,
  draftName,
  draftSubject,
  draftPreview,
}: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [testSentTo, setTestSentTo] = useState<string | null>(null);
  const [provider, setProvider] = useState<"locaweb" | "iporto">("locaweb");

  useEffect(() => {
    if (!workspaceId) return;
    fetch("/api/crm/email-templates/provider", {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d: { provider?: "locaweb" | "iporto" }) => {
        setProvider(d?.provider === "iporto" ? "iporto" : "locaweb");
      })
      .catch(() => setProvider("locaweb"));
  }, [workspaceId]);

  const [lists, setLists] = useState<LocawebList[] | null>(null);
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set());

  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [scheduledTime, setScheduledTime] = useState("09:00");
  // Modo rascunho-com-aprovação: a campanha fica salva como
  // pending_approval. Outro membro do time precisa aprovar (botão na
  // tela de drafts) antes do disparo de fato ir pra Locaweb.
  const [requiresApproval, setRequiresApproval] = useState(false);

  // Quando o modo aprovação é ativado, força o agendamento (data + hora
  // obrigatórios pra rascunho com aprovação).
  useEffect(() => {
    if (requiresApproval) setScheduleEnabled(true);
  }, [requiresApproval]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    locaweb_message_id?: string;
    scheduled?: string | null;
    pendingApproval?: boolean;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setStepIndex(0);
    setReviewed(false);
    setTestSentTo(null);
    setLists(null);
    setSelectedListIds(new Set());
    setScheduleEnabled(false);
    setRequiresApproval(false);
    setError(null);
    setSuccess(null);
    setSubmitting(false);
  }, [open]);

  // Lazy-load lists when we hit the audience step.
  useEffect(() => {
    if (!open || stepIndex < 2 || lists !== null) return;
    fetch("/api/crm/email-templates/locaweb/lists", {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.reason === "not_configured") {
          setError(
            "Locaweb ainda não configurada. Vá em Configurações > Email Marketing antes de disparar."
          );
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
  }, [open, stepIndex, lists, workspaceId]);

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

  const totalContacts = lists
    ? Array.from(selectedListIds)
        .map((id) => lists.find((l) => l.id === id)?.contacts_count ?? 0)
        .reduce((a, b) => a + b, 0)
    : 0;

  const submit = async () => {
    if (selectedListIds.size === 0) {
      setError("Escolha ao menos uma lista.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/crm/email-templates/drafts/${draftId}/dispatch`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-workspace-id": workspaceId,
          },
          body: JSON.stringify({
            list_ids: Array.from(selectedListIds),
            scheduled_to: scheduleEnabled
              ? `${scheduledDate}T${scheduledTime}:00-03:00`
              : undefined,
            requires_approval: requiresApproval,
          }),
        }
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Falha ao disparar.");
      setSuccess({
        locaweb_message_id: d.locaweb_message_id,
        scheduled: d.scheduled_to,
        pendingApproval: d.status === "pending_approval",
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const DraftInfo = (
    <div className="text-xs flex items-start gap-2 p-3 border rounded bg-muted/30">
      <Inbox className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="font-medium truncate">{draftName ?? "Draft"}</div>
        {draftSubject && (
          <div className="text-[10px] text-muted-foreground truncate">
            Subject: {draftSubject}
          </div>
        )}
      </div>
    </div>
  );

  const stepReview: WizardStep = {
    id: "review",
    label: "Conteúdo",
    canProceed: reviewed,
    nextHint: !reviewed ? "Marque o checkbox pra continuar" : undefined,
    content: (
      <>
        {DraftInfo}
        <div className="space-y-3 border rounded-md p-4">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Mail className="w-3 h-3" />
              Subject (linha de assunto)
            </div>
            <div className="text-sm font-medium">
              {draftSubject || (
                <span className="text-amber-700 dark:text-amber-300">
                  (sem subject — preencha no editor antes de disparar)
                </span>
              )}
            </div>
          </div>
          <div className="space-y-1 border-t pt-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Preview text (texto curto que aparece na lista do inbox)
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              {draftPreview ? (
                draftPreview
              ) : (
                <span className="italic">
                  Sem preview definido. Sem isso, os clients de email vão usar
                  os primeiros caracteres do corpo como prévia — pode ser
                  qualquer coisa. Recomendado: voltar no editor e preencher.
                </span>
              )}
            </div>
          </div>
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
            Li o subject e o preview e está tudo correto.
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
        {DraftInfo}
        <TestSendCard
          endpoint={`/api/crm/email-templates/drafts/${draftId}/test-dispatch`}
          workspaceId={workspaceId}
          onSent={(email) => setTestSentTo(email)}
        />
      </>
    ),
  };

  const stepAudience: WizardStep = {
    id: "audience",
    label: "Listas",
    canProceed: selectedListIds.size > 0,
    nextHint:
      selectedListIds.size === 0 ? "Selecione ao menos uma lista" : undefined,
    content: (
      <>
        {DraftInfo}
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground">
            Listas Locaweb
          </Label>
          {lists === null ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando...
            </div>
          ) : lists.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 border rounded">
              <AlertTriangle className="w-3.5 h-3.5" />
              Nenhuma lista. Crie uma no painel da Locaweb ou na página de CRM.
            </div>
          ) : (
            <div className="border rounded-md max-h-56 overflow-y-auto divide-y">
              {lists.map((l) => {
                const sel = selectedListIds.has(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => toggleList(l.id)}
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
          estimatedRecipients={totalContacts}
          provider={provider}
        />
      </>
    ),
  };

  const stepSchedule: WizardStep = {
    id: "schedule",
    label: "Agendar",
    // Quando o modo aprovação está ligado, exigimos data + hora.
    canProceed: !requiresApproval || scheduleEnabled,
    nextHint: requiresApproval && !scheduleEnabled
      ? "Modo rascunho com aprovação exige data e hora de envio."
      : undefined,
    content: (
      <>
        {DraftInfo}
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

        <div className="space-y-2 border rounded-md p-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
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
              ? "Nada vai pra Locaweb agora. A campanha fica em Pendentes na lista de drafts até alguém do time aprovar — aí dispara na data + hora marcadas acima (obrigatórias nesse modo)."
              : "Envio direto: a Locaweb recebe a campanha e dispara conforme o agendamento acima."}
          </p>
        </div>
      </>
    ),
  };

  const stepConfirm: WizardStep = {
    id: "confirm",
    label: "Revisar",
    canProceed: selectedListIds.size > 0,
    content: (
      <>
        <div className="space-y-3 border rounded-md p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <ListChecks className="w-3 h-3" />
            Resumo do disparo
          </div>
          <SummaryRow
            label="Subject"
            value={draftSubject ?? "(sem subject)"}
            mono
          />
          <SummaryRow label="Preview" value={draftPreview ?? "(sem preview)"} />
          <SummaryRow
            label="Listas"
            value={
              <>
                {Array.from(selectedListIds).map((id) => {
                  const l = lists?.find((x) => x.id === id);
                  return (
                    <div key={id}>
                      {l?.name ?? id}
                      {l?.contacts_count != null && (
                        <span className="text-muted-foreground">
                          {" "}
                          ({l.contacts_count.toLocaleString("pt-BR")})
                        </span>
                      )}
                    </div>
                  );
                })}
                {selectedListIds.size === 0 && (
                  <span className="text-destructive">
                    Nenhuma lista selecionada
                  </span>
                )}
              </>
            }
          />
          <SummaryRow
            label="Total estimado"
            value={`${totalContacts.toLocaleString("pt-BR")} contatos`}
          />
          <SummaryRow
            label="Quando"
            value={
              scheduleEnabled
                ? `${scheduledDate} às ${scheduledTime}${
                    requiresApproval ? " (após aprovação)" : ""
                  }`
                : "Agora (assim que confirmar)"
            }
          />
          <SummaryRow
            label="Aprovação"
            value={
              requiresApproval ? (
                <span className="text-amber-700 dark:text-amber-300 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  Precisa aprovação de outro membro
                </span>
              ) : (
                <span className="text-emerald-700 dark:text-emerald-300">
                  Envio direto
                </span>
              )
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

  const steps = [stepReview, stepTest, stepAudience, stepSchedule, stepConfirm];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-xl">
        <DialogTitle className="flex items-center gap-2">
          <Send className="w-4 h-4" />
          Disparar campanha
        </DialogTitle>

        {success ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 border border-emerald-300 bg-emerald-100 dark:bg-emerald-950 dark:border-emerald-700 rounded-md">
              <CheckCircle2 className="w-5 h-5 text-emerald-700 dark:text-emerald-300 shrink-0 mt-0.5" />
              <div className="text-xs">
                <div className="font-medium text-emerald-900 dark:text-emerald-100">
                  {success.pendingApproval
                    ? "Rascunho enviado pra aprovação"
                    : success.scheduled
                    ? `Campanha agendada para ${success.scheduled}`
                    : "Campanha enviada à Locaweb"}
                </div>
                {success.pendingApproval ? (
                  <div className="text-muted-foreground mt-1">
                    Outro membro do time precisa aprovar nos seus drafts pra o
                    envio sair. Nada foi pra Locaweb ainda.
                  </div>
                ) : (
                  <>
                    <div className="text-muted-foreground mt-0.5">
                      ID Locaweb:{" "}
                      <span className="font-mono">{success.locaweb_message_id}</span>
                    </div>
                    <div className="text-muted-foreground mt-1">
                      Stats começam a aparecer aqui em algumas horas.
                    </div>
                  </>
                )}
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
              requiresApproval
                ? "Enviar pra aprovação"
                : scheduleEnabled
                ? `Agendar ${scheduledDate} ${scheduledTime}`
                : "Disparar agora"
            }
            finishIcon={
              requiresApproval ? (
                <ShieldCheck className="w-3.5 h-3.5" />
              ) : scheduleEnabled ? (
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
