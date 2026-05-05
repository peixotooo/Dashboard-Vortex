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
  Target,
} from "lucide-react";
import type { EmailSuggestion } from "@/lib/email-templates/types";

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
  const [lists, setLists] = useState<LocawebList[] | null>(null);
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set());
  const [useSegment, setUseSegment] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledTo, setScheduledTo] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    locaweb_message_id: string;
    scheduled?: string | null;
    materialized_segment?: { list_name: string; count: number } | null;
  } | null>(null);

  useEffect(() => {
    if (!suggestion) return;
    setLists(null);
    setError(null);
    setSelectedListIds(new Set());
    setUseSegment(false);
    setSuccess(null);
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
  }, [suggestion, workspaceId]);

  if (!suggestion) return null;

  const segmentLabel =
    (suggestion.target_segment_payload as { display_label?: string })
      ?.display_label ?? "—";
  const segmentSize =
    (suggestion.target_segment_payload as { estimated_size?: number })
      ?.estimated_size ?? null;

  const close = () => {
    if (loading) return;
    onClose();
  };

  const toggle = (id: string) => {
    setSelectedListIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (selectedListIds.size === 0 && !useSegment) {
      setError("Escolha ao menos uma lista ou ative o segmento sugerido.");
      return;
    }
    setLoading(true);
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
            scheduled_to: scheduleEnabled ? scheduledTo : undefined,
            // Pass the suggestion's segment label as the utm_term so click
            // attribution can split campaign performance by segment.
            utm_term: (suggestion.target_segment_payload as { display_label?: string })
              ?.display_label,
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
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!suggestion} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="flex items-center gap-2">
          <Send className="w-4 h-4" />
          Disparar sugestão
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
                  Stats começam a aparecer no painel de relatórios em algumas horas.
                </div>
                {success.materialized_segment && (
                  <div className="text-muted-foreground mt-1">
                    Segmento materializado em lista{" "}
                    <span className="font-mono">{success.materialized_segment.list_name}</span>{" "}
                    com {success.materialized_segment.count.toLocaleString("pt-BR")} contatos.
                  </div>
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
          <>
            {/* Info card sobre a sugestão */}
            <div className="space-y-2 -mt-2">
              <div className="text-xs flex items-start gap-2 p-3 border rounded bg-muted/30">
                <Inbox className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="font-medium truncate">
                    {suggestion.product_snapshot.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Slot {suggestion.slot} · {SLOT_LABEL[suggestion.slot]} · gerado em{" "}
                    {suggestion.generated_for_date}
                  </div>
                  <div className="text-[10px] flex items-center gap-1.5 text-muted-foreground">
                    <Target className="w-2.5 h-2.5" />
                    Segmentação sugerida: <span className="text-foreground">{segmentLabel}</span>
                    {segmentSize != null && (
                      <span>· ~{segmentSize.toLocaleString("pt-BR")} contatos</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                Para quem enviar
              </Label>

              {/* Virtual "segmento sugerido" row. When toggled on, the
                  backend materializes the RFM cluster into a fresh Locaweb
                  list on the fly and dispatches there. */}
              <button
                type="button"
                onClick={() => setUseSegment((v) => !v)}
                disabled={loading || segmentSize == null || segmentSize === 0}
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
                  Nenhuma lista. Use o segmento sugerido acima ou crie uma no painel da Locaweb.
                </div>
              ) : (
                <div className="border rounded-md max-h-56 overflow-y-auto divide-y">
                  {lists.map((l) => {
                    const idStr = String(l.id);
                    const sel = selectedListIds.has(idStr);
                    return (
                      <button
                        key={idStr}
                        type="button"
                        onClick={() => toggle(idStr)}
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
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Você pode combinar listas existentes com o segmento sugerido — a Locaweb
                deduplica destinatários no envio.
              </p>
            </div>

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
              {scheduleEnabled && (
                <Input
                  type="date"
                  value={scheduledTo}
                  onChange={(e) => setScheduledTo(e.target.value)}
                  disabled={loading}
                  className="h-9 text-xs"
                  min={new Date().toISOString().slice(0, 10)}
                />
              )}
            </div>

            {error && (
              <div className="text-xs text-destructive p-2 border border-destructive/30 rounded bg-destructive/5">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={close} disabled={loading}>
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={loading || (selectedListIds.size === 0 && !useSegment)}
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
                    ? `Agendar ${scheduledTo}`
                    : "Disparar"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
