"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  XCircle,
  CheckCircle2,
  Clock,
  Send,
  AlertCircle,
  Ban,
  RefreshCw,
  Image,
  FileText,
  Video,
  Music,
  MessageSquare,
  FileEdit,
  Play,
  Pencil,
  Trash2,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  WAPI_MESSAGE_TYPE_LABELS,
  isWapiMessageType,
} from "@/lib/whatsapp/wapi-message-types";

interface Dispatch {
  id: string;
  message_type: string;
  content: string | null;
  media_url: string | null;
  file_name: string | null;
  status: string;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  target_groups: Array<{ jid: string; name: string | null }>;
  total_groups: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
}

interface DispatchMessage {
  group_jid: string;
  group_name: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    icon: React.ElementType;
  }
> = {
  draft: { label: "Rascunho", variant: "outline", icon: FileEdit },
  completed: { label: "Enviado", variant: "default", icon: CheckCircle2 },
  sending: { label: "Enviando", variant: "secondary", icon: Send },
  scheduled: { label: "Agendado", variant: "outline", icon: Clock },
  queued: { label: "Na fila", variant: "outline", icon: Clock },
  failed: { label: "Falhou", variant: "destructive", icon: AlertCircle },
  cancelled: { label: "Cancelado", variant: "secondary", icon: Ban },
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  text: MessageSquare,
  image: Image,
  video: Video,
  audio: Music,
  document: FileText,
};

const CONTENT_EDITABLE_TYPES = new Set([
  "text",
  "image",
  "video",
  "document",
  "gif",
  "button_actions",
  "buttons",
  "otp",
  "carousel",
  "poll",
]);

const MESSAGE_CONTENT_TYPES = new Set([
  "text",
  "button_actions",
  "buttons",
  "otp",
  "carousel",
  "poll",
]);

interface DispatchLogProps {
  workspaceId: string;
}

export function DispatchLog({ workspaceId }: DispatchLogProps) {
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DispatchMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Dispatch | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editScheduleEnabled, setEditScheduleEnabled] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const limit = 15;

  const fetchDispatches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/whatsapp-groups/dispatches?page=${page}&limit=${limit}`,
        { headers: { "x-workspace-id": workspaceId } },
      );
      if (res.ok) {
        const json = await res.json();
        setDispatches(json.data || []);
        setTotal(json.total || 0);
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId, page]);

  useEffect(() => {
    fetchDispatches();
  }, [fetchDispatches]);

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setMessages([]);
      return;
    }
    setExpandedId(id);
    setMessagesLoading(true);
    try {
      const res = await fetch(`/api/whatsapp-groups/dispatches/${id}`, {
        headers: { "x-workspace-id": workspaceId },
      });
      if (res.ok) {
        const json = await res.json();
        setMessages(json.messages || []);
      }
    } finally {
      setMessagesLoading(false);
    }
  };

  const handleCancel = async (id: string) => {
    setCancellingId(id);
    try {
      const res = await fetch(`/api/whatsapp-groups/dispatches/${id}`, {
        method: "DELETE",
        headers: { "x-workspace-id": workspaceId },
      });
      if (res.ok) fetchDispatches();
    } finally {
      setCancellingId(null);
    }
  };

  const handleActivate = async (id: string) => {
    setActivatingId(id);
    try {
      const res = await fetch(
        `/api/whatsapp-groups/dispatches/${id}/activate`,
        {
          method: "POST",
          headers: { "x-workspace-id": workspaceId },
        },
      );
      if (res.ok) fetchDispatches();
    } finally {
      setActivatingId(null);
    }
  };

  const handleDelete = async (d: Dispatch) => {
    const label = d.status === "draft" ? "rascunho" : "agendamento";
    if (!confirm(`Excluir este ${label}? Esta ação é irreversível.`)) return;
    setDeletingId(d.id);
    try {
      const res = await fetch(
        `/api/whatsapp-groups/dispatches/${d.id}?hard=true`,
        {
          method: "DELETE",
          headers: { "x-workspace-id": workspaceId },
        },
      );
      if (res.ok) fetchDispatches();
    } finally {
      setDeletingId(null);
    }
  };

  const openEdit = (d: Dispatch) => {
    setEditing(d);
    setEditError(null);
    setEditContent(d.content || "");
    if (d.scheduled_at) {
      const dt = new Date(d.scheduled_at);
      const pad = (n: number) => String(n).padStart(2, "0");
      setEditDate(
        `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`,
      );
      setEditTime(`${pad(dt.getHours())}:${pad(dt.getMinutes())}`);
      setEditScheduleEnabled(true);
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setEditDate(tomorrow.toISOString().slice(0, 10));
      setEditTime("09:00");
      setEditScheduleEnabled(false);
    }
  };

  const submitEdit = async () => {
    if (!editing) return;
    const isDraft = editing.status === "draft";
    let scheduledIso: string | null | undefined;
    if (editScheduleEnabled) {
      const when = new Date(`${editDate}T${editTime}:00-03:00`);
      if (Number.isNaN(when.getTime())) {
        setEditError("Data/hora inválida.");
        return;
      }
      if (!isDraft && when.getTime() <= Date.now()) {
        setEditError("Pra agendamento, a data precisa estar no futuro.");
        return;
      }
      scheduledIso = when.toISOString();
    } else if (isDraft) {
      scheduledIso = null;
    } else {
      setEditError("Agendamento precisa de data prevista.");
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/whatsapp-groups/dispatches/${editing.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          content: editContent,
          scheduled_at: scheduledIso,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError(data.error ?? "Falha ao salvar edição.");
        return;
      }
      setEditing(null);
      await fetchDispatches();
    } finally {
      setEditBusy(false);
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total} disparo{total !== 1 ? "s" : ""} registrado
          {total !== 1 ? "s" : ""}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={fetchDispatches}
          disabled={loading}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`}
          />
          Atualizar
        </Button>
      </div>

      {loading && dispatches.length === 0 ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : dispatches.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
          Nenhum disparo registrado ainda
        </div>
      ) : (
        <div className="space-y-2">
          {dispatches.map((d) => {
            const config = STATUS_CONFIG[d.status] || STATUS_CONFIG.queued;
            const StatusIcon = config.icon;
            const TypeIcon = TYPE_ICONS[d.message_type] || MessageSquare;
            const typeLabel = isWapiMessageType(d.message_type)
              ? WAPI_MESSAGE_TYPE_LABELS[d.message_type]
              : d.message_type;
            const isExpanded = expandedId === d.id;

            return (
              <div
                key={d.id}
                className="border border-border rounded-lg overflow-hidden"
              >
                <button
                  type="button"
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                  onClick={() => toggleExpand(d.id)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}

                  <TypeIcon className="h-4 w-4 shrink-0 text-muted-foreground" />

                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">
                      {d.content || d.file_name || "(sem conteudo)"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {typeLabel} &middot;{" "}
                      {format(new Date(d.created_at), "dd/MM/yyyy 'as' HH:mm", {
                        locale: ptBR,
                      })}
                      {d.scheduled_at &&
                        (d.status === "scheduled" || d.status === "draft") && (
                          <>
                            {" "}
                            &middot;{" "}
                            {d.status === "draft"
                              ? "Data prevista"
                              : "Agendado para"}{" "}
                            {format(new Date(d.scheduled_at), "dd/MM HH:mm", {
                              locale: ptBR,
                            })}
                          </>
                        )}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {d.total_groups} grupo{d.total_groups !== 1 ? "s" : ""}
                    </span>
                    {d.status === "completed" && d.sent_count > 0 && (
                      <Badge
                        variant="default"
                        className="text-xs bg-emerald-600"
                      >
                        {d.sent_count}
                      </Badge>
                    )}
                    {d.status === "completed" && d.failed_count > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {d.failed_count}
                      </Badge>
                    )}
                    <Badge variant={config.variant} className="text-xs gap-1">
                      <StatusIcon className="h-3 w-3" />
                      {config.label}
                    </Badge>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border bg-muted/30 px-4 py-3">
                    {d.media_url && (
                      <div className="mb-3">
                        {d.message_type === "image" ? (
                          <img
                            src={d.media_url}
                            alt="Media"
                            className="max-h-32 rounded-md"
                          />
                        ) : (
                          <a
                            href={d.media_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary underline"
                          >
                            {d.file_name || d.media_url}
                          </a>
                        )}
                      </div>
                    )}

                    {d.content && (
                      <p className="text-sm mb-3 whitespace-pre-wrap bg-background rounded-md p-2 border border-border">
                        {d.content}
                      </p>
                    )}

                    <h5 className="text-xs font-medium mb-2 text-muted-foreground">
                      Resultado por grupo
                    </h5>

                    {messagesLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Carregando...
                      </div>
                    ) : messages.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {d.status === "scheduled"
                          ? "Disparo agendado - resultados aparecerao apos o envio"
                          : "Nenhum resultado registrado"}
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {messages.map((msg, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between text-xs"
                          >
                            <span className="truncate min-w-0">
                              {msg.group_name || msg.group_jid}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                              {msg.status === "sent" ? (
                                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                              ) : (
                                <XCircle className="h-3 w-3 text-destructive" />
                              )}
                              {msg.error_message && (
                                <span className="text-destructive max-w-[200px] truncate">
                                  {msg.error_message}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {(d.status === "draft" || d.status === "scheduled") && (
                      <div className="mt-3 pt-2 border-t border-border flex items-center gap-2 flex-wrap">
                        {d.status === "draft" && (
                          <Button
                            type="button"
                            size="sm"
                            disabled={activatingId === d.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleActivate(d.id);
                            }}
                            title={
                              d.scheduled_at &&
                              new Date(d.scheduled_at).getTime() > Date.now()
                                ? "Ativar e deixar agendado pra data prevista"
                                : "Ativar e enviar agora"
                            }
                          >
                            {activatingId === d.id ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            ) : (
                              <Play className="h-3.5 w-3.5 mr-1" />
                            )}
                            {d.scheduled_at &&
                            new Date(d.scheduled_at).getTime() > Date.now()
                              ? "Ativar agendamento"
                              : "Ativar e enviar"}
                          </Button>
                        )}

                        {CONTENT_EDITABLE_TYPES.has(d.message_type) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(d);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5 mr-1" />
                            Editar
                          </Button>
                        )}

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={deletingId === d.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(d);
                          }}
                          title="Excluir (não pode ser desfeito)"
                        >
                          {deletingId === d.id ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5 mr-1" />
                          )}
                          Excluir
                        </Button>

                        {d.status === "scheduled" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground"
                            disabled={cancellingId === d.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancel(d.id);
                            }}
                          >
                            {cancellingId === d.id ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            ) : (
                              <Ban className="h-3.5 w-3.5 mr-1" />
                            )}
                            Cancelar
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </Button>
          <span className="text-xs text-muted-foreground">
            {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Proximo
          </Button>
        </div>
      )}

      {/* Edição inline de rascunho/agendamento */}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setEditError(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing?.status === "draft"
                ? "Editar rascunho"
                : "Editar agendamento"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                {editing && MESSAGE_CONTENT_TYPES.has(editing.message_type)
                  ? editing.message_type === "poll"
                    ? "Pergunta"
                    : "Mensagem"
                  : "Legenda"}
              </Label>
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={5}
                placeholder={
                  editing?.message_type === "poll"
                    ? "Pergunta da enquete"
                    : editing && MESSAGE_CONTENT_TYPES.has(editing.message_type)
                      ? "Texto da mensagem"
                      : "Legenda (opcional)"
                }
              />
              {editing && !MESSAGE_CONTENT_TYPES.has(editing.message_type) && (
                <p className="text-[11px] text-muted-foreground">
                  Edição altera só a legenda. Pra trocar mídia/tipo, exclua e
                  recrie.
                </p>
              )}
            </div>

            <div className="space-y-2 border rounded-md p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Data prevista
                  {editing?.status !== "draft" && (
                    <span className="normal-case text-muted-foreground/70 ml-1">
                      (obrigatória)
                    </span>
                  )}
                </Label>
                {editing?.status === "draft" && (
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
                        editScheduleEnabled
                          ? "translate-x-5"
                          : "translate-x-[2px]"
                      }`}
                    />
                  </button>
                )}
              </div>
              {(editing?.status !== "draft" || editScheduleEnabled) && (
                <div className="flex gap-2 pt-1">
                  <Input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="h-9 text-xs flex-1"
                    min={
                      editing?.status === "draft"
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
                {editing?.status === "draft"
                  ? editScheduleEnabled
                    ? "Ao ativar, vai pra Agendado se a data ainda estiver no futuro — senão entra direto na fila."
                    : "Sem data: ao ativar, vai direto pra fila de envio."
                  : "Mudar essa data reagenda o envio."}
              </p>
            </div>

            {editError && (
              <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-md p-2">
                {editError}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setEditing(null)}
                disabled={editBusy}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1"
                onClick={submitEdit}
                disabled={editBusy}
              >
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
