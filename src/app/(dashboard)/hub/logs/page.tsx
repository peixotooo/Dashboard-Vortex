"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Search,
  FileText,
  X,
  CheckCircle2,
  XCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";
import type { HubLog } from "@/types/hub";

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
const ACTION_LABELS: Record<string, { label: string; icon: typeof ArrowDownToLine; color: string }> = {
  pull_eccosys: { label: "Pull Eccosys", icon: ArrowDownToLine, color: "text-orange-500" },
  push_ml: { label: "Push ML", icon: ArrowUpFromLine, color: "text-blue-500" },
  pull_ml: { label: "Pull ML", icon: ArrowDownToLine, color: "text-yellow-500" },
  pull_order: { label: "Pull Pedido", icon: ArrowDownToLine, color: "text-purple-500" },
  push_order_eccosys: { label: "Push Pedido Ecc", icon: ArrowUpFromLine, color: "text-orange-500" },
  sync_nfe: { label: "Sync NF-e", icon: ArrowLeftRight, color: "text-green-500" },
  sync_stock: { label: "Sync Estoque", icon: RefreshCw, color: "text-blue-500" },
  webhook_received: { label: "Webhook", icon: ArrowDownToLine, color: "text-gray-500" },
  error: { label: "Erro", icon: XCircle, color: "text-red-500" },
};

function ActionLabel({ action }: { action: string }) {
  const config = ACTION_LABELS[action] || {
    label: action,
    icon: FileText,
    color: "text-muted-foreground",
  };
  const Icon = config.icon;
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={`h-3.5 w-3.5 ${config.color}`} />
      <span className="text-xs font-medium">{config.label}</span>
    </div>
  );
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// -------------------------------------------------------------------
// Main Page
// -------------------------------------------------------------------
export default function HubLogsPage() {
  const { workspace } = useWorkspace();

  const [logs, setLogs] = useState<HubLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [actionFilter, setActionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");

  const fetchLogs = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (actionFilter) params.set("action", actionFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (entityFilter) params.set("entity", entityFilter);

      const res = await fetch(`/api/hub/logs?${params}`, {
        headers: { "x-workspace-id": workspace.id },
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [workspace?.id, page, actionFilter, statusFilter, entityFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Logs do Hub</h1>
          <p className="text-sm text-muted-foreground">
            {total} registro(s)
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchLogs}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Acao" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="pull_eccosys">Pull Eccosys</SelectItem>
                <SelectItem value="push_ml">Push ML</SelectItem>
                <SelectItem value="pull_ml">Pull ML</SelectItem>
                <SelectItem value="pull_order">Pull Pedido</SelectItem>
                <SelectItem value="push_order_eccosys">Push Pedido Ecc</SelectItem>
                <SelectItem value="sync_nfe">Sync NF-e</SelectItem>
                <SelectItem value="sync_stock">Sync Estoque</SelectItem>
                <SelectItem value="webhook_received">Webhook</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="ok">OK</SelectItem>
                <SelectItem value="error">Erro</SelectItem>
              </SelectContent>
            </Select>
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Entidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="product">Produto</SelectItem>
                <SelectItem value="order">Pedido</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setActionFilter("");
                setStatusFilter("");
                setEntityFilter("");
                setPage(0);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Logs Timeline */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileText className="h-10 w-10 mb-3" />
              <p className="text-sm font-medium">Nenhum log encontrado</p>
            </div>
          ) : (
            <div className="divide-y">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 p-4 hover:bg-muted/30"
                >
                  {/* Status icon */}
                  <div className="mt-0.5">
                    {log.status === "ok" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <ActionLabel action={log.action} />
                      {log.entity && (
                        <span className="text-xs text-muted-foreground capitalize">
                          {log.entity}
                        </span>
                      )}
                      {log.entity_id && (
                        <span className="text-xs font-mono text-muted-foreground">
                          {log.entity_id}
                        </span>
                      )}
                      {log.direction && (
                        <span className="text-xs text-muted-foreground">
                          ({log.direction})
                        </span>
                      )}
                    </div>

                    {/* Details */}
                    {log.details && (
                      <pre className="mt-1 text-xs text-muted-foreground overflow-auto max-h-20 font-mono">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    )}
                  </div>

                  {/* Timestamp */}
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatTime(log.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {total > 100 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Pagina {page + 1} de {Math.ceil(total / 100)}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!logs.length || logs.length < 100}
              onClick={() => setPage((p) => p + 1)}
            >
              Proxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
