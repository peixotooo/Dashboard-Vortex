"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

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
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ElementType }
> = {
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
  const limit = 15;

  const fetchDispatches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/whatsapp-groups/dispatches?page=${page}&limit=${limit}`,
        { headers: { "x-workspace-id": workspaceId } }
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

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total} disparo{total !== 1 ? "s" : ""} registrado{total !== 1 ? "s" : ""}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={fetchDispatches}
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
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
                      {format(
                        new Date(d.created_at),
                        "dd/MM/yyyy 'as' HH:mm",
                        { locale: ptBR }
                      )}
                      {d.scheduled_at && d.status === "scheduled" && (
                        <>
                          {" "}
                          &middot; Agendado para{" "}
                          {format(
                            new Date(d.scheduled_at),
                            "dd/MM HH:mm",
                            { locale: ptBR }
                          )}
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
                        className="text-xs bg-green-600"
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
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
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

                    {d.status === "scheduled" && (
                      <div className="mt-3 pt-2 border-t border-border">
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
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
                          Cancelar agendamento
                        </Button>
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
    </div>
  );
}
