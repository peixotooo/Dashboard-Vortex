"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

interface TemplateComponent {
  type: string;
  text?: string;
  format?: string;
  buttons?: Array<{ type: string; text: string; url?: string }>;
}

interface CampaignDetail {
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
  variable_values: Record<string, string> | null;
  segment_filter: Record<string, unknown> | null;
  attribution_window_days?: number | null;
  message_cost_usd?: number | null;
  exchange_rate?: number | null;
  wa_templates: {
    id: string;
    meta_id: string | null;
    name: string;
    language: string;
    category: string;
    status: string;
    components: TemplateComponent[];
    synced_at: string | null;
  } | null;
}

interface RecheckResult {
  ok: boolean;
  changed: boolean;
  previousCategory: string | null;
  currentCategory: string | null;
  previousStatus: string | null;
  currentStatus: string | null;
  reason?: string;
}

interface Props {
  campaignId: string | null;
  workspaceId: string;
  onClose: () => void;
  onChanged?: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  queued: "Na fila",
  scheduled: "Agendada",
  sending: "Enviando",
  completed: "Concluida",
  failed: "Falhou",
  cancelled: "Cancelada",
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderTemplatePreview(
  components: TemplateComponent[],
  variables: Record<string, string>
): { header: string | null; body: string; footer: string | null; buttons: Array<{ text: string; url?: string }> } {
  const header = components.find((c) => c.type === "HEADER");
  const body = components.find((c) => c.type === "BODY");
  const footer = components.find((c) => c.type === "FOOTER");
  const buttonsComp = components.find((c) => c.type === "BUTTONS");

  const fillVars = (text: string) => {
    let out = text;
    for (const [k, v] of Object.entries(variables || {})) {
      // k is in form "{{1}}"
      out = out.replaceAll(k, v || k);
    }
    return out;
  };

  return {
    header: header?.text ? fillVars(header.text) : null,
    body: body?.text ? fillVars(body.text) : "(sem corpo)",
    footer: footer?.text || null,
    buttons:
      buttonsComp?.buttons?.map((b) => ({ text: b.text, url: b.url })) || [],
  };
}

export function CampaignDetailsDialog({
  campaignId,
  workspaceId,
  onClose,
  onChanged,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [recheckResult, setRecheckResult] = useState<RecheckResult | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const open = !!campaignId;

  const headers = useCallback(
    () => ({
      "x-workspace-id": workspaceId,
      "Content-Type": "application/json",
    }),
    [workspaceId]
  );

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setError(null);
    setRecheckResult(null);
    try {
      const res = await fetch(`/api/crm/whatsapp/campaigns/${campaignId}`, {
        headers: headers(),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setCampaign(data.campaign);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    }
    setLoading(false);
  }, [campaignId, headers]);

  useEffect(() => {
    if (open) load();
    else {
      setCampaign(null);
      setRecheckResult(null);
      setError(null);
    }
  }, [open, load]);

  async function handleRecheck() {
    if (!campaignId) return;
    setRechecking(true);
    setRecheckResult(null);
    try {
      const res = await fetch(
        `/api/crm/whatsapp/campaigns/${campaignId}/recheck-template`,
        { method: "POST", headers: headers() }
      );
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setRecheckResult(data.recheck);
        // Reload to pick up updated template fields
        if (data.recheck?.changed) {
          await load();
          onChanged?.();
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao verificar");
    }
    setRechecking(false);
  }

  async function handleCancel() {
    if (!campaignId) return;
    if (!confirm("Cancelar esta campanha? Essa acao nao pode ser desfeita.")) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/crm/whatsapp/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ action: "cancel" }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        await load();
        onChanged?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao cancelar");
    }
    setCancelling(false);
  }

  const cancellable = campaign && ["scheduled", "queued", "draft"].includes(campaign.status);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Detalhes da Campanha
            {campaign && (
              <Badge
                variant={
                  campaign.status === "completed" || campaign.status === "sending"
                    ? "default"
                    : campaign.status === "failed" || campaign.status === "cancelled"
                    ? "destructive"
                    : "secondary"
                }
              >
                {STATUS_LABELS[campaign.status] || campaign.status}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        {campaign && !loading && (
          <div className="space-y-5 text-sm">
            {/* Identity */}
            <section>
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                Identificacao
              </h3>
              <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
                <div className="font-medium text-base">{campaign.name}</div>
                <div className="text-xs text-muted-foreground">ID: {campaign.id}</div>
                {campaign.segment_filter &&
                  typeof campaign.segment_filter === "object" &&
                  "segment" in (campaign.segment_filter as Record<string, unknown>) && (
                    <div className="text-xs">
                      Segmento:{" "}
                      <span className="font-medium">
                        {String(
                          (campaign.segment_filter as Record<string, unknown>).segment
                        )}
                      </span>
                    </div>
                  )}
              </div>
            </section>

            {/* Schedule */}
            <section>
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                Agendamento e Execucao
              </h3>
              <div className="rounded-md border bg-muted/30 p-3 grid grid-cols-2 gap-x-4 gap-y-2">
                <div className="flex items-start gap-2">
                  <CalendarClock className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <div>
                    <div className="text-xs text-muted-foreground">Configurada</div>
                    <div className="font-medium">{fmtDateTime(campaign.created_at)}</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Clock className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <div>
                    <div className="text-xs text-muted-foreground">Programada para</div>
                    <div className="font-medium">
                      {campaign.scheduled_at ? fmtDateTime(campaign.scheduled_at) : "Envio imediato"}
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Clock className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <div>
                    <div className="text-xs text-muted-foreground">Iniciada</div>
                    <div className="font-medium">{fmtDateTime(campaign.started_at)}</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <div>
                    <div className="text-xs text-muted-foreground">Concluida</div>
                    <div className="font-medium">{fmtDateTime(campaign.completed_at)}</div>
                  </div>
                </div>
              </div>
            </section>

            {/* Counts */}
            <section>
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                Volumes
              </h3>
              <div className="rounded-md border bg-muted/30 p-3 grid grid-cols-5 gap-2 text-center">
                <div>
                  <div className="font-bold">{campaign.total_messages}</div>
                  <div className="text-xs text-muted-foreground">Total</div>
                </div>
                <div>
                  <div className="font-bold text-blue-600">{campaign.sent_count}</div>
                  <div className="text-xs text-muted-foreground">Enviadas</div>
                </div>
                <div>
                  <div className="font-bold text-green-600">{campaign.delivered_count}</div>
                  <div className="text-xs text-muted-foreground">Entregues</div>
                </div>
                <div>
                  <div className="font-bold text-purple-600">{campaign.read_count}</div>
                  <div className="text-xs text-muted-foreground">Lidas</div>
                </div>
                <div>
                  <div className="font-bold text-red-600">{campaign.failed_count}</div>
                  <div className="text-xs text-muted-foreground">Falhas</div>
                </div>
              </div>
            </section>

            {/* Template */}
            {campaign.wa_templates ? (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
                    Template e Mensagem
                  </h3>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleRecheck}
                    disabled={rechecking || !campaign.wa_templates.meta_id}
                    title="Consulta a Meta para detectar reclassificacao de categoria (custo)"
                  >
                    {rechecking ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Verificar na Meta
                  </Button>
                </div>

                <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{campaign.wa_templates.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {campaign.wa_templates.language}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={
                        campaign.wa_templates.category === "MARKETING"
                          ? "border-purple-500/40 text-purple-400"
                          : campaign.wa_templates.category === "AUTHENTICATION"
                          ? "border-amber-500/40 text-amber-400"
                          : "border-sky-500/40 text-sky-400"
                      }
                    >
                      {campaign.wa_templates.category}
                    </Badge>
                    <Badge
                      variant={campaign.wa_templates.status === "APPROVED" ? "default" : "secondary"}
                      className="gap-1"
                    >
                      {campaign.wa_templates.status === "APPROVED" && (
                        <ShieldCheck className="h-3 w-3" />
                      )}
                      {campaign.wa_templates.status}
                    </Badge>
                    {campaign.wa_templates.synced_at && (
                      <span className="text-[11px] text-muted-foreground ml-auto">
                        Sincronizado: {fmtDateTime(campaign.wa_templates.synced_at)}
                      </span>
                    )}
                  </div>

                  {recheckResult && (
                    <div
                      className={`rounded-md border p-2.5 text-xs ${
                        recheckResult.changed
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                          : "border-green-500/30 bg-green-500/10 text-green-400"
                      }`}
                    >
                      {!recheckResult.ok ? (
                        <div className="flex items-start gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>
                            Falha ao consultar Meta ({recheckResult.reason || "erro desconhecido"}).
                          </span>
                        </div>
                      ) : recheckResult.changed ? (
                        <div className="flex items-start gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <div>
                            <div className="font-medium">Template foi alterado na Meta!</div>
                            {recheckResult.previousCategory !== recheckResult.currentCategory && (
                              <div>
                                Categoria: {recheckResult.previousCategory} →{" "}
                                <span className="font-semibold">
                                  {recheckResult.currentCategory}
                                </span>
                                {recheckResult.currentCategory === "MARKETING" && (
                                  <span className="ml-1">(custo aumentou)</span>
                                )}
                              </div>
                            )}
                            {recheckResult.previousStatus !== recheckResult.currentStatus && (
                              <div>
                                Status: {recheckResult.previousStatus} →{" "}
                                <span className="font-semibold">
                                  {recheckResult.currentStatus}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          <span>
                            Template confere com a Meta. Categoria{" "}
                            <strong>{recheckResult.currentCategory}</strong>, status{" "}
                            <strong>{recheckResult.currentStatus}</strong>.
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {(() => {
                    const preview = renderTemplatePreview(
                      campaign.wa_templates!.components || [],
                      campaign.variable_values || {}
                    );
                    return (
                      <div className="bg-background rounded-md border p-3 space-y-2">
                        {preview.header && (
                          <div className="font-semibold text-sm">{preview.header}</div>
                        )}
                        <div className="whitespace-pre-wrap text-sm">{preview.body}</div>
                        {preview.footer && (
                          <div className="text-xs text-muted-foreground border-t pt-2">
                            {preview.footer}
                          </div>
                        )}
                        {preview.buttons.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {preview.buttons.map((b, i) => (
                              <Badge key={i} variant="outline" className="text-xs font-normal">
                                {b.text}
                                {b.url && (
                                  <span className="ml-1 text-muted-foreground">↗</span>
                                )}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {campaign.variable_values &&
                    Object.keys(campaign.variable_values).length > 0 && (
                      <div className="text-xs">
                        <div className="text-muted-foreground mb-1">Variaveis:</div>
                        <div className="grid grid-cols-2 gap-1">
                          {Object.entries(campaign.variable_values).map(([k, v]) => (
                            <div
                              key={k}
                              className="flex justify-between gap-2 bg-background/50 rounded px-2 py-1"
                            >
                              <span className="font-mono text-muted-foreground">{k}</span>
                              <span className="truncate">{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              </section>
            ) : (
              <div className="text-sm text-muted-foreground italic">
                Template removido ou indisponivel.
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t">
              {cancellable && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleCancel}
                  disabled={cancelling}
                >
                  {cancelling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : null}
                  Cancelar campanha
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={onClose}>
                Fechar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
