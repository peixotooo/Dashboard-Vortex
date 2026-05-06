"use client";
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
} from "lucide-react";
import { TestSendCard } from "../../../components/test-send-card";
import { BalanceCard } from "../../../components/balance-card";

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
}

type Stage = "test" | "real";

export function DispatchDialog({
  open,
  onClose,
  draftId,
  workspaceId,
  draftName,
  draftSubject,
}: Props) {
  const [stage, setStage] = useState<Stage>("test");
  const [testSentTo, setTestSentTo] = useState<string | null>(null);

  const [lists, setLists] = useState<LocawebList[] | null>(null);
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set());
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    locaweb_message_id: string;
    scheduled?: string | null;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setStage("test");
    setTestSentTo(null);
    setLists(null);
    setSelectedListIds(new Set());
    setScheduleEnabled(false);
    setError(null);
    setSuccess(null);
  }, [open]);

  useEffect(() => {
    if (!open || stage !== "real" || lists !== null) return;
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
  }, [open, stage, lists, workspaceId]);

  const toggle = (id: string) => {
    setSelectedListIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const close = () => {
    if (loading) return;
    onClose();
  };

  const submit = async () => {
    if (selectedListIds.size === 0) {
      setError("Escolha ao menos uma lista.");
      return;
    }
    setLoading(true);
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
          }),
        }
      );
      const d = await r.json();
      if (!r.ok) {
        throw new Error(d.error ?? "Falha ao disparar.");
      }
      setSuccess({
        locaweb_message_id: d.locaweb_message_id,
        scheduled: d.scheduled_to,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const totalContacts = lists
    ? Array.from(selectedListIds)
        .map((id) => lists.find((l) => l.id === id)?.contacts_count ?? 0)
        .reduce((a, b) => a + b, 0)
    : 0;

  const DraftInfo = draftSubject ? (
    <div className="text-xs flex items-start gap-1.5 p-2 border rounded bg-muted/30">
      <Inbox className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <div className="text-muted-foreground">Subject:</div>
        <div className="font-medium truncate">{draftSubject}</div>
        {draftName && (
          <div className="text-[10px] text-muted-foreground/70 truncate mt-0.5">
            {draftName}
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="flex items-center gap-2">
          <Send className="w-4 h-4" />
          Disparar campanha
        </DialogTitle>

        {success ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 rounded-md">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <div className="font-medium text-emerald-700 dark:text-emerald-300">
                  {success.scheduled
                    ? `Campanha agendada para ${success.scheduled}`
                    : "Campanha enviada à Locaweb"}
                </div>
                <div className="text-muted-foreground mt-0.5">
                  ID Locaweb: <span className="font-mono">{success.locaweb_message_id}</span>
                </div>
                <div className="text-muted-foreground mt-1">
                  Stats (open/click/bounce) começam a aparecer aqui em algumas
                  horas conforme os destinatários abrem o email.
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={close}>
                Fechar
              </Button>
            </div>
          </div>
        ) : stage === "test" ? (
          <>
            {DraftInfo && <div className="space-y-2 -mt-2">{DraftInfo}</div>}

            <TestSendCard
              endpoint={`/api/crm/email-templates/drafts/${draftId}/test-dispatch`}
              workspaceId={workspaceId}
              onSent={(email) => setTestSentTo(email)}
            />

            <div className="flex justify-between gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={close}>
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setError(null);
                  setStage("real");
                }}
                className="gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                {testSentTo ? "Continuar para envio real" : "Pular teste e disparar"}
              </Button>
            </div>
          </>
        ) : (
          <>
            {DraftInfo && <div className="space-y-2 -mt-2">{DraftInfo}</div>}

            {testSentTo && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground -mt-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                Teste enviado para{" "}
                <span className="font-mono">{testSentTo}</span>.
                <button
                  type="button"
                  onClick={() => setStage("test")}
                  className="underline hover:text-foreground"
                >
                  Reenviar
                </button>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                Listas
              </Label>
              {lists === null ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando listas Locaweb...
                </div>
              ) : lists.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 border rounded">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Nenhuma lista encontrada na Locaweb. Crie uma no painel da
                  Locaweb antes de disparar.
                </div>
              ) : (
                <div className="border rounded-md max-h-56 overflow-y-auto divide-y">
                  {lists.map((l) => {
                    const sel = selectedListIds.has(l.id);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => toggle(l.id)}
                        disabled={loading}
                        className={`w-full flex items-center gap-2 p-2.5 text-left hover:bg-muted/40 disabled:opacity-50 ${
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
                          <div className="text-xs font-medium truncate">
                            {l.name}
                          </div>
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
            />

            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  Agendar
                </Label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={scheduleEnabled}
                  disabled={loading}
                  onClick={() => setScheduleEnabled((v) => !v)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors disabled:opacity-50 ${
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
                    disabled={loading}
                    className="h-9 text-xs flex-1"
                    min={new Date().toISOString().slice(0, 10)}
                  />
                  <Input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    disabled={loading}
                    className="h-9 text-xs w-28"
                    step={300}
                  />
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground">
                  Sem agendamento, dispara agora.
                </p>
              )}
            </div>

            {error && (
              <div className="text-xs text-destructive p-2 border border-destructive/30 rounded bg-destructive/5">
                {error}
              </div>
            )}

            <div className="flex justify-between gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setError(null);
                  setStage("test");
                }}
                disabled={loading}
              >
                Voltar
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={close} disabled={loading}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={submit}
                  disabled={loading || selectedListIds.size === 0}
                  className="gap-1.5"
                >
                  {loading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  {loading
                    ? "Enviando..."
                    : scheduleEnabled
                      ? `Agendar ${scheduledDate} ${scheduledTime}`
                      : "Disparar agora"}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
