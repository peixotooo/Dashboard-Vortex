"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
  Loader2,
  Search,
  Package,
  X,
  Check,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";
import type { HubOrder } from "@/types/hub";

// -------------------------------------------------------------------
// Order sync status badge
// -------------------------------------------------------------------
function OrderStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: string }> = {
    pending: {
      label: "Pendente",
      variant: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    },
    imported: {
      label: "Importado",
      variant: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    },
    error: {
      label: "Erro",
      variant: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    },
    ignored: {
      label: "Ignorado",
      variant: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    },
    tracking_sent: {
      label: "Rastreio Enviado",
      variant: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    },
    nfe_sent: {
      label: "NF-e Enviada",
      variant: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    },
  };
  const badge = map[status] || map.pending;
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${badge.variant}`}>
      {badge.label}
    </span>
  );
}

function MLStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">-</span>;
  const colorMap: Record<string, string> = {
    paid: "text-green-600 border-green-300",
    confirmed: "text-green-600 border-green-300",
    payment_required: "text-yellow-600 border-yellow-300",
    payment_in_process: "text-yellow-600 border-yellow-300",
    cancelled: "text-red-600 border-red-300",
  };
  return (
    <Badge
      variant="outline"
      className={`text-xs ${colorMap[status] || "text-muted-foreground"}`}
    >
      {status}
    </Badge>
  );
}

// -------------------------------------------------------------------
// Main Page
// -------------------------------------------------------------------
export default function HubPedidosPage() {
  const { workspace } = useWorkspace();

  const [orders, setOrders] = useState<HubOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [syncFilter, setSyncFilter] = useState("");

  // Action states
  const [pushingIds, setPushingIds] = useState<Set<number>>(new Set());

  const fetchOrders = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set("search", search);
      if (syncFilter) params.set("sync_status", syncFilter);

      const res = await fetch(`/api/hub/orders?${params}`, {
        headers: { "x-workspace-id": workspace.id },
      });
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [workspace?.id, page, search, syncFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  async function handlePushToEccosys(mlOrderId: number) {
    if (!workspace?.id) return;
    setPushingIds((prev) => new Set(prev).add(mlOrderId));
    try {
      const res = await fetch("/api/sync/push-order-eccosys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspace.id,
        },
        body: JSON.stringify({ ml_order_id: mlOrderId }),
      });
      if (res.ok) {
        fetchOrders();
      } else {
        const data = await res.json();
        alert(`Erro: ${data.error}`);
      }
    } finally {
      setPushingIds((prev) => {
        const next = new Set(prev);
        next.delete(mlOrderId);
        return next;
      });
    }
  }

  async function handleReprocess(mlOrderId: number) {
    if (!workspace?.id) return;
    setPushingIds((prev) => new Set(prev).add(mlOrderId));
    try {
      const res = await fetch("/api/sync/pull-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspace.id,
        },
        body: JSON.stringify({ ml_order_id: mlOrderId }),
      });
      if (res.ok) {
        fetchOrders();
      }
    } finally {
      setPushingIds((prev) => {
        const next = new Set(prev);
        next.delete(mlOrderId);
        return next;
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pedidos do Hub</h1>
          <p className="text-sm text-muted-foreground">
            {total} pedido(s) no hub
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchOrders}
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
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por comprador, ML ID ou numero Eccosys..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setPage(0);
                    fetchOrders();
                  }
                }}
                className="pl-9"
              />
            </div>
            <Select value={syncFilter} onValueChange={setSyncFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="imported">Importado</SelectItem>
                <SelectItem value="error">Erro</SelectItem>
                <SelectItem value="tracking_sent">Rastreio Enviado</SelectItem>
                <SelectItem value="nfe_sent">NF-e Enviada</SelectItem>
                <SelectItem value="ignored">Ignorado</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSearch("");
                setSyncFilter("");
                setPage(0);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Orders Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Package className="h-10 w-10 mb-3" />
              <p className="text-sm font-medium">Nenhum pedido no hub</p>
              <p className="text-xs mt-1">
                Pedidos do ML chegam automaticamente via webhook
              </p>
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="p-3 text-left font-medium"># ML</th>
                    <th className="p-3 text-left font-medium">Data</th>
                    <th className="p-3 text-left font-medium">Comprador</th>
                    <th className="p-3 text-right font-medium">Total</th>
                    <th className="p-3 text-center font-medium">Status ML</th>
                    <th className="p-3 text-center font-medium">Hub</th>
                    <th className="p-3 text-center font-medium">Eccosys</th>
                    <th className="p-3 text-center font-medium">NF-e</th>
                    <th className="p-3 text-center font-medium">Rastreio</th>
                    <th className="p-3 text-center font-medium">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-t hover:bg-muted/30">
                      <td className="p-3">
                        <div className="font-mono text-xs font-medium">
                          {order.ml_pack_id || order.ml_order_id}
                        </div>
                        {order.ml_pack_id && (
                          <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                            order {order.ml_order_id}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-xs whitespace-nowrap">
                        {order.ml_date
                          ? new Date(order.ml_date).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "-"}
                      </td>
                      <td className="p-3 truncate max-w-[180px]">
                        {order.buyer_name || "-"}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        {order.total != null
                          ? Number(order.total).toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })
                          : "-"}
                      </td>
                      <td className="p-3 text-center">
                        <MLStatusBadge status={order.ml_status} />
                      </td>
                      <td className="p-3 text-center">
                        <OrderStatusBadge status={order.sync_status} />
                      </td>
                      <td className="p-3 text-center">
                        {order.ecc_numero ? (
                          <span className="text-xs font-mono">
                            {order.ecc_numero}
                          </span>
                        ) : order.ecc_pedido_id ? (
                          <span className="text-xs font-mono">
                            #{order.ecc_pedido_id}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        {order.ecc_nfe_numero ? (
                          <div>
                            <span className="text-xs font-mono">
                              {order.ecc_nfe_numero}
                            </span>
                            {order.nfe_xml_sent_at ? (
                              <div className="text-[10px] text-green-600 mt-0.5">ML ok</div>
                            ) : (
                              <div className="text-[10px] text-muted-foreground mt-0.5">pendente</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        {order.ecc_rastreio ? (
                          <span className="text-xs font-mono">
                            {order.ecc_rastreio}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {/* Push to Eccosys */}
                          {order.sync_status === "pending" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Importar no Eccosys"
                              disabled={pushingIds.has(order.ml_order_id)}
                              onClick={() =>
                                handlePushToEccosys(order.ml_order_id)
                              }
                            >
                              {pushingIds.has(order.ml_order_id) ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <ArrowUpFromLine className="h-3.5 w-3.5 text-orange-500" />
                              )}
                            </Button>
                          )}

                          {/* Reprocess (re-pull from ML) */}
                          {order.sync_status === "error" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Reprocessar"
                              disabled={pushingIds.has(order.ml_order_id)}
                              onClick={() =>
                                handleReprocess(order.ml_order_id)
                              }
                            >
                              {pushingIds.has(order.ml_order_id) ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3.5 w-3.5 text-blue-500" />
                              )}
                            </Button>
                          )}

                          {/* Error indicator */}
                          {order.error_msg && (
                            <span
                              title={order.error_msg}
                              className="cursor-help"
                            >
                              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                            </span>
                          )}

                          {/* Success indicator */}
                          {order.sync_status === "imported" && (
                            <Check className="h-3.5 w-3.5 text-green-500" />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {total > 50 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Pagina {page + 1} de {Math.ceil(total / 50)}
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
              disabled={!orders.length || orders.length < 50}
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
