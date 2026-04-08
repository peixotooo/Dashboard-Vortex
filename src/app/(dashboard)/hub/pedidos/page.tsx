"use client";

import React, { useCallback, useEffect, useState } from "react";
import Image from "next/image";
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
  ChevronDown,
  ChevronRight,
  User,
  MapPin,
  CreditCard,
  ShoppingCart,
  Truck,
  FileText,
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useWorkspace } from "@/lib/workspace-context";
import type { HubOrder, HubOrderItem } from "@/types/hub";

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

  // Detail sheet
  const [selectedOrder, setSelectedOrder] = useState<HubOrder | null>(null);
  const [expandedPacks, setExpandedPacks] = useState<Set<string>>(new Set());

  // Action states
  const [pushingIds, setPushingIds] = useState<Set<number>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    linked: number;
    not_found: number;
    tracking_sent: number;
    nfe_sent: number;
  } | null>(null);

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

  async function handlePushPackToEccosys(packOrders: HubOrder[]) {
    if (!workspace?.id) return;
    const ids = packOrders.map((o) => o.ml_order_id);
    for (const id of ids) setPushingIds((prev) => new Set(prev).add(id));
    try {
      for (const mlOrderId of ids) {
        const res = await fetch("/api/sync/push-order-eccosys", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-workspace-id": workspace.id,
          },
          body: JSON.stringify({ ml_order_id: mlOrderId }),
        });
        if (!res.ok) {
          const data = await res.json();
          alert(`Erro no pedido ${mlOrderId}: ${data.error}`);
        }
      }
      fetchOrders();
    } finally {
      setPushingIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  }

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

  async function handleBatchSync() {
    if (!workspace?.id) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/sync/batch-sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspace.id,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setSyncResult(data.summary);
        fetchOrders();
      } else {
        const data = await res.json();
        alert(`Erro: ${data.error}`);
      }
    } finally {
      setSyncing(false);
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

  async function handleSendNfe(mlOrderId: number) {
    if (!workspace?.id) return;
    setPushingIds((prev) => new Set(prev).add(mlOrderId));
    try {
      const res = await fetch("/api/sync/upload-nfe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspace.id,
        },
        body: JSON.stringify({ ml_order_ids: [mlOrderId] }),
      });
      const data = await res.json();
      if (res.ok && data.sent > 0) {
        fetchOrders();
      } else if (data.errors && data.errors.length > 0) {
        alert(`Erro: ${data.errors[0].error}`);
      } else {
        alert("Nenhuma NF foi enviada");
      }
    } catch (err) {
      alert(`Erro: ${err instanceof Error ? err.message : "desconhecido"}`);
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
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={handleBatchSync}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ArrowDownToLine className="h-4 w-4 mr-2" />
            )}
            Sincronizar Pedidos
          </Button>
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
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex gap-4 text-sm">
              {syncResult.linked > 0 && (
                <span className="text-green-700 dark:text-green-300">
                  {syncResult.linked} vinculado(s)
                </span>
              )}
              {syncResult.tracking_sent > 0 && (
                <span className="text-blue-700 dark:text-blue-300">
                  {syncResult.tracking_sent} rastreio(s) enviado(s)
                </span>
              )}
              {syncResult.nfe_sent > 0 && (
                <span className="text-purple-700 dark:text-purple-300">
                  {syncResult.nfe_sent} NF-e(s) enviada(s)
                </span>
              )}
              {syncResult.not_found > 0 && (
                <span className="text-yellow-700 dark:text-yellow-300">
                  {syncResult.not_found} nao encontrado(s) no Eccosys
                </span>
              )}
              {syncResult.linked === 0 && syncResult.tracking_sent === 0 && syncResult.nfe_sent === 0 && syncResult.not_found === 0 && (
                <span className="text-muted-foreground">Nenhuma alteracao</span>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setSyncResult(null)}
            >
              <X className="h-3 w-3" />
            </Button>
          </CardContent>
        </Card>
      )}

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
                  {(() => {
                    // Group orders by pack_id
                    const groups = new Map<string, HubOrder[]>();
                    for (const o of orders) {
                      const key = o.ml_pack_id ? String(o.ml_pack_id) : String(o.ml_order_id);
                      const arr = groups.get(key) || [];
                      arr.push(o);
                      groups.set(key, arr);
                    }

                    return [...groups.entries()].map(([packKey, packOrders]) => {
                      const isPack = packOrders.length > 1;
                      const first = packOrders[0];
                      const isExpanded = expandedPacks.has(packKey);
                      const packTotal = packOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);

                      // Single order (no pack) — render as before
                      if (!isPack) {
                        return (
                          <OrderRow
                            key={first.id}
                            order={first}
                            pushingIds={pushingIds}
                            onPush={handlePushToEccosys}
                            onReprocess={handleReprocess}
                            onSendNfe={handleSendNfe}
                            onClick={() => setSelectedOrder(first)}
                          />
                        );
                      }

                      // Pack group — clicking row opens combined detail, chevron expands individual orders
                      // Create a virtual "combined" order for the sheet
                      const combinedOrder: HubOrder = {
                        ...first,
                        total: packTotal,
                        items: packOrders.flatMap((o) => o.items || []),
                      };

                      return (
                        <React.Fragment key={packKey}>
                          {/* Pack header row */}
                          <tr
                            className="border-t hover:bg-muted/30 cursor-pointer"
                            onClick={() => setSelectedOrder(combinedOrder)}
                          >
                            <td className="p-3">
                              <div className="flex items-center gap-1">
                                <button
                                  className="p-0.5 hover:bg-muted rounded"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedPacks((prev) => {
                                      const next = new Set(prev);
                                      next.has(packKey) ? next.delete(packKey) : next.add(packKey);
                                      return next;
                                    });
                                  }}
                                >
                                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                </button>
                                <div>
                                  <div className="font-mono text-xs font-medium">{packKey}</div>
                                  <div className="text-[10px] text-muted-foreground">{packOrders.length} pedidos</div>
                                </div>
                              </div>
                            </td>
                            <td className="p-3 text-xs whitespace-nowrap">
                              {first.ml_date ? new Date(first.ml_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-"}
                            </td>
                            <td className="p-3 truncate max-w-[180px]">{first.buyer_name || "-"}</td>
                            <td className="p-3 text-right whitespace-nowrap font-medium">
                              {packTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </td>
                            <td className="p-3 text-center"><MLStatusBadge status={first.ml_status} /></td>
                            <td className="p-3 text-center"><OrderStatusBadge status={first.sync_status} /></td>
                            <td className="p-3 text-center"><span className="text-xs text-muted-foreground">-</span></td>
                            <td className="p-3 text-center"><span className="text-xs text-muted-foreground">-</span></td>
                            <td className="p-3 text-center">
                              {first.ecc_rastreio ? <span className="text-xs font-mono">{first.ecc_rastreio}</span> : <span className="text-xs text-muted-foreground">-</span>}
                            </td>
                            <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-center gap-1">
                                {packOrders.some((o) => o.sync_status === "pending") && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    title="Importar pack no Eccosys"
                                    disabled={packOrders.some((o) => pushingIds.has(o.ml_order_id))}
                                    onClick={() => handlePushPackToEccosys(packOrders)}
                                  >
                                    {packOrders.some((o) => pushingIds.has(o.ml_order_id)) ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <ArrowUpFromLine className="h-3.5 w-3.5 text-orange-500" />
                                    )}
                                  </Button>
                                )}
                                {packOrders.some((o) => o.ecc_pedido_id && !o.nfe_xml_sent_at && o.ml_status !== "cancelled") && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    title="Enviar NF do pack ao ML"
                                    disabled={packOrders.some((o) => pushingIds.has(o.ml_order_id))}
                                    onClick={async () => {
                                      for (const o of packOrders) {
                                        if (o.ecc_pedido_id && !o.nfe_xml_sent_at && o.ml_status !== "cancelled") {
                                          await handleSendNfe(o.ml_order_id);
                                        }
                                      }
                                    }}
                                  >
                                    {packOrders.some((o) => pushingIds.has(o.ml_order_id)) ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <FileText className="h-3.5 w-3.5 text-purple-500" />
                                    )}
                                  </Button>
                                )}
                                {packOrders.every((o) => o.sync_status === "imported") && (
                                  <Check className="h-3.5 w-3.5 text-green-500" />
                                )}
                                {packOrders.some((o) => o.error_msg) && (
                                  <span title={packOrders.filter((o) => o.error_msg).map((o) => o.error_msg).join("\n")} className="cursor-help">
                                    <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* Pack children (expanded) — no individual actions */}
                          {isExpanded && packOrders.map((order) => (
                            <OrderRow
                              key={order.id}
                              order={order}
                              pushingIds={pushingIds}
                              onPush={handlePushToEccosys}
                              onReprocess={handleReprocess}
                              onClick={() => setSelectedOrder(order)}
                              isChild
                              hideActions
                            />
                          ))}
                        </React.Fragment>
                      );
                    });
                  })()}
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
      {/* Order Detail Sheet */}
      <Sheet open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <SheetContent className="w-full sm:max-w-[500px] overflow-y-auto">
          {selectedOrder && <OrderDetail order={selectedOrder} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// -------------------------------------------------------------------
// Order Row (reusable for single orders and pack children)
// -------------------------------------------------------------------
function OrderRow({ order, pushingIds, onPush, onReprocess, onSendNfe, onClick, isChild, hideActions }: {
  order: HubOrder;
  pushingIds: Set<number>;
  onPush: (id: number) => void;
  onReprocess: (id: number) => void;
  onSendNfe?: (id: number) => void;
  onClick: () => void;
  isChild?: boolean;
  hideActions?: boolean;
}) {
  const isCancelled = order.ml_status === "cancelled";
  return (
    <tr className={`border-t hover:bg-muted/30 cursor-pointer ${isChild ? "bg-muted/10" : ""} ${isCancelled ? "opacity-50 bg-red-50/30 dark:bg-red-950/10" : ""}`} onClick={onClick}>
      <td className="p-3">
        <div className={`font-mono text-xs ${isChild ? "pl-5" : "font-medium"}`}>
          {isChild ? (
            <span className="text-muted-foreground">order {order.ml_order_id}</span>
          ) : (
            <>
              {order.ml_pack_id || order.ml_order_id}
              {order.ml_pack_id && (
                <div className="text-[10px] text-muted-foreground mt-0.5">order {order.ml_order_id}</div>
              )}
            </>
          )}
        </div>
      </td>
      <td className="p-3 text-xs whitespace-nowrap">
        {order.ml_date ? new Date(order.ml_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-"}
      </td>
      <td className="p-3 truncate max-w-[180px]">{order.buyer_name || "-"}</td>
      <td className="p-3 text-right whitespace-nowrap">
        {order.total != null ? Number(order.total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "-"}
      </td>
      <td className="p-3 text-center"><MLStatusBadge status={order.ml_status} /></td>
      <td className="p-3 text-center"><OrderStatusBadge status={order.sync_status} /></td>
      <td className="p-3 text-center">
        {order.ecc_numero ? <span className="text-xs font-mono">{order.ecc_numero}</span>
          : order.ecc_pedido_id ? <span className="text-xs font-mono">#{order.ecc_pedido_id}</span>
          : <span className="text-xs text-muted-foreground">-</span>}
      </td>
      <td className="p-3 text-center">
        {order.ecc_nfe_numero ? (
          <div>
            <span className="text-xs font-mono">{order.ecc_nfe_numero}</span>
            {order.nfe_xml_sent_at ? <div className="text-[10px] text-green-600 mt-0.5">ML ok</div> : <div className="text-[10px] text-muted-foreground mt-0.5">pendente</div>}
          </div>
        ) : <span className="text-xs text-muted-foreground">-</span>}
      </td>
      <td className="p-3 text-center">
        {order.ecc_rastreio ? <span className="text-xs font-mono">{order.ecc_rastreio}</span> : <span className="text-xs text-muted-foreground">-</span>}
      </td>
      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
        {hideActions ? (
          <span className="text-xs text-muted-foreground">-</span>
        ) : (
          <div className="flex items-center justify-center gap-1">
            {order.sync_status === "pending" && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Importar no Eccosys" disabled={pushingIds.has(order.ml_order_id)} onClick={() => onPush(order.ml_order_id)}>
                {pushingIds.has(order.ml_order_id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpFromLine className="h-3.5 w-3.5 text-orange-500" />}
              </Button>
            )}
            {order.sync_status === "error" && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Reprocessar" disabled={pushingIds.has(order.ml_order_id)} onClick={() => onReprocess(order.ml_order_id)}>
                {pushingIds.has(order.ml_order_id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 text-blue-500" />}
              </Button>
            )}
            {onSendNfe && order.ecc_pedido_id && !order.nfe_xml_sent_at && order.ml_status !== "cancelled" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Enviar NF ao ML"
                disabled={pushingIds.has(order.ml_order_id)}
                onClick={() => onSendNfe(order.ml_order_id)}
              >
                {pushingIds.has(order.ml_order_id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5 text-purple-500" />}
              </Button>
            )}
            {order.error_msg && <span title={order.error_msg} className="cursor-help"><AlertTriangle className="h-3.5 w-3.5 text-destructive" /></span>}
            {(order.sync_status === "imported" || order.sync_status === "tracking_sent" || order.sync_status === "nfe_sent") && (
              <Check className="h-3.5 w-3.5 text-green-500" />
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

// -------------------------------------------------------------------
// Order Detail Sheet Content
// -------------------------------------------------------------------
function OrderDetail({ order }: { order: HubOrder }) {
  const { workspace } = useWorkspace();
  const addr = order.endereco as Record<string, unknown> | null;
  const payment = order.pagamento as Record<string, unknown> | null;
  const items = (order.items || []) as HubOrderItem[];

  // Fetch product images from hub_products
  const [imageMap, setImageMap] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!workspace?.id || items.length === 0) return;
    const mlItemIds = [...new Set(items.map((i) => i.ml_item_id).filter(Boolean))];
    if (mlItemIds.length === 0) return;
    (async () => {
      try {
        const map: Record<string, string> = {};
        // Fetch each ML item's product to get the image
        for (const mlId of mlItemIds) {
          const res = await fetch(
            `/api/hub/products?search=${mlId}&page_size=5`,
            { headers: { "x-workspace-id": workspace.id } }
          );
          const data = await res.json();
          const products = data.products || data.data || [];
          for (const p of products) {
            if (p.fotos && p.fotos.length > 0 && p.ml_item_id && !map[p.ml_item_id]) {
              map[p.ml_item_id] = p.fotos[0];
            }
          }
        }
        setImageMap(map);
      } catch { /* ignore */ }
    })();
  }, [workspace?.id, order.ml_order_id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <SheetHeader className="pb-4">
        <SheetTitle className="text-base">
          Pedido {order.ml_pack_id || order.ml_order_id}
        </SheetTitle>
        <div className="flex items-center gap-2 mt-1">
          <MLStatusBadge status={order.ml_status} />
          <OrderStatusBadge status={order.sync_status} />
        </div>
      </SheetHeader>

      <div className="space-y-5 text-sm">
        {/* Order IDs */}
        <Section icon={<Package className="h-4 w-4" />} title="Identificacao">
          <InfoRow label="Order ID" value={String(order.ml_order_id)} mono />
          {order.ml_pack_id && <InfoRow label="Pack ID" value={String(order.ml_pack_id)} mono />}
          {order.ml_shipment_id && <InfoRow label="Shipment ID" value={String(order.ml_shipment_id)} mono />}
          <InfoRow label="Data" value={order.ml_date ? new Date(order.ml_date).toLocaleString("pt-BR") : "-"} />
        </Section>

        {/* Buyer */}
        <Section icon={<User className="h-4 w-4" />} title="Comprador">
          <InfoRow label="Nome" value={order.buyer_name || "-"} />
          <InfoRow label="Email" value={order.buyer_email || "-"} />
          <InfoRow label="CPF/CNPJ" value={order.buyer_doc || "-"} mono />
        </Section>

        {/* Items */}
        <Section icon={<ShoppingCart className="h-4 w-4" />} title={`Items (${items.length})`}>
          {items.length > 0 ? (
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="rounded border p-2 flex gap-3">
                  {/* Product image */}
                  <div className="relative w-14 h-14 flex-shrink-0 rounded overflow-hidden bg-muted">
                    {imageMap[item.ml_item_id] ? (
                      <Image
                        src={imageMap[item.ml_item_id]}
                        alt={item.nome}
                        fill
                        className="object-cover"
                        sizes="56px"
                        unoptimized
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  {/* Product info */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-xs truncate">{item.nome}</div>
                    <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                      <span className="font-mono">{item.sku}</span>
                      <span className="font-medium text-foreground">
                        {item.qtd}x {Number(item.preco).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">{item.ml_item_id}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Sem items</p>
          )}
        </Section>

        {/* Totals */}
        <Section icon={<CreditCard className="h-4 w-4" />} title="Valores">
          <InfoRow label="Total" value={order.total != null ? Number(order.total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "-"} bold />
          <InfoRow label="Frete" value={order.frete != null ? Number(order.frete).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "-"} />
          {payment ? (
            <>
              {payment.payment_method_id ? <InfoRow label="Metodo" value={String(payment.payment_method_id)} /> : null}
              {payment.status ? <InfoRow label="Status Pagamento" value={String(payment.status)} /> : null}
              {payment.installments ? <InfoRow label="Parcelas" value={`${String(payment.installments)}x`} /> : null}
            </>
          ) : null}
        </Section>

        {/* Address */}
        {addr && (
          <Section icon={<MapPin className="h-4 w-4" />} title="Endereco">
            {addr.street_name ? <InfoRow label="Rua" value={`${String(addr.street_name)}${addr.street_number ? `, ${String(addr.street_number)}` : ""}`} /> : null}
            {addr.comment ? <InfoRow label="Complemento" value={String(addr.comment)} /> : null}
            {addr.neighborhood ? <InfoRow label="Bairro" value={String(typeof addr.neighborhood === "object" ? (addr.neighborhood as Record<string, unknown>).name || "" : addr.neighborhood)} /> : null}
            {addr.city ? <InfoRow label="Cidade" value={String(typeof addr.city === "object" ? (addr.city as Record<string, unknown>).name || "" : addr.city)} /> : null}
            {addr.state ? <InfoRow label="Estado" value={String(typeof addr.state === "object" ? (addr.state as Record<string, unknown>).name || "" : addr.state)} /> : null}
            {addr.zip_code ? <InfoRow label="CEP" value={String(addr.zip_code)} mono /> : null}
          </Section>
        )}

        {/* Eccosys / NF-e / Tracking */}
        <Section icon={<FileText className="h-4 w-4" />} title="Eccosys / NF-e / Rastreio">
          <InfoRow label="Pedido Eccosys" value={order.ecc_numero || (order.ecc_pedido_id ? `#${order.ecc_pedido_id}` : "-")} mono />
          <InfoRow label="Situacao" value={order.ecc_situacao != null ? String(order.ecc_situacao) : "-"} />
          <InfoRow label="NF-e" value={order.ecc_nfe_numero || "-"} mono />
          {order.ecc_nfe_chave && <InfoRow label="Chave NF-e" value={order.ecc_nfe_chave} mono />}
          <InfoRow label="NF-e enviada ML" value={order.nfe_xml_sent_at ? new Date(order.nfe_xml_sent_at).toLocaleString("pt-BR") : "Nao"} />
          <InfoRow label="Rastreio" value={order.ecc_rastreio || "-"} mono />
        </Section>

        {/* Shipping */}
        <Section icon={<Truck className="h-4 w-4" />} title="Envio">
          <InfoRow label="Faturamento" value={order.ecc_data_faturamento ? new Date(order.ecc_data_faturamento).toLocaleString("pt-BR") : "-"} />
        </Section>

        {/* Error */}
        {order.error_msg && (
          <div className="rounded border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950 p-3">
            <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400 text-xs font-medium mb-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Erro
            </div>
            <p className="text-xs text-red-600 dark:text-red-400">{order.error_msg}</p>
          </div>
        )}
      </div>
    </>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase mb-2">
        {icon}
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function InfoRow({ label, value, mono, bold }: { label: string; value: string; mono?: boolean; bold?: boolean }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`${mono ? "font-mono" : ""} ${bold ? "font-semibold" : ""} text-right max-w-[280px] truncate`}>{value}</span>
    </div>
  );
}
