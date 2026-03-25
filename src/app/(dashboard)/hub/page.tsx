"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  Package,
  ShoppingCart,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Settings,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace-context";

interface HubStats {
  eccosysConnected: boolean;
  eccosysAmbiente: string | null;
  mlConnected: boolean;
  mlNickname: string | null;
  totalProducts: number;
  eccosysProducts: number;
  mlProducts: number;
  linkedProducts: number;
  pendingOrders: number;
  recentErrors: number;
}

export default function HubPage() {
  const { workspace } = useWorkspace();
  const [stats, setStats] = useState<HubStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspace?.id) return;
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  async function fetchStats() {
    setLoading(true);
    try {
      const res = await fetch("/api/hub/stats", {
        headers: { "x-workspace-id": workspace!.id },
      });
      if (res.ok) {
        setStats(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Hub Eccosys / Mercado Livre</h1>
          <p className="text-sm text-muted-foreground">
            Central de sincronizacao de produtos e pedidos
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/hub/logs">Ver Logs</Link>
        </Button>
      </div>

      {/* Connection Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-muted p-2">
                  <Settings className="h-4 w-4 text-orange-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Eccosys
                  </p>
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin mt-1" />
                  ) : stats?.eccosysConnected ? (
                    <div className="flex items-center gap-2 mt-1">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="text-sm font-semibold">
                        {stats.eccosysAmbiente}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-1">
                      <XCircle className="h-4 w-4 text-destructive" />
                      <span className="text-sm text-muted-foreground">
                        Nao conectado
                      </span>
                    </div>
                  )}
                </div>
              </div>
              {!stats?.eccosysConnected && !loading && (
                <Button variant="outline" size="sm" asChild>
                  <Link href="/settings">Configurar</Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-muted p-2">
                  <ArrowLeftRight className="h-4 w-4 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Mercado Livre
                  </p>
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin mt-1" />
                  ) : stats?.mlConnected ? (
                    <div className="flex items-center gap-2 mt-1">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="text-sm font-semibold">
                        @{stats.mlNickname}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-1">
                      <XCircle className="h-4 w-4 text-destructive" />
                      <span className="text-sm text-muted-foreground">
                        Nao conectado
                      </span>
                    </div>
                  )}
                </div>
              </div>
              {!stats?.mlConnected && !loading && (
                <Button variant="outline" size="sm" asChild>
                  <a href={`/api/ml/auth?workspace_id=${workspace?.id}`}>Conectar</a>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard
          title="Produtos no Hub"
          value={loading ? "..." : String(stats?.totalProducts ?? 0)}
          icon={Package}
          iconColor="text-blue-500"
          loading={loading}
          badge={
            stats
              ? `${stats.eccosysProducts} Ecc / ${stats.mlProducts} ML`
              : undefined
          }
        />
        <KpiCard
          title="Vinculados"
          value={loading ? "..." : String(stats?.linkedProducts ?? 0)}
          icon={ArrowLeftRight}
          iconColor="text-green-500"
          loading={loading}
        />
        <KpiCard
          title="Pedidos Pendentes"
          value={loading ? "..." : String(stats?.pendingOrders ?? 0)}
          icon={ShoppingCart}
          iconColor="text-purple-500"
          loading={loading}
        />
        <KpiCard
          title="Erros (24h)"
          value={loading ? "..." : String(stats?.recentErrors ?? 0)}
          icon={AlertTriangle}
          iconColor={
            stats && stats.recentErrors > 0
              ? "text-destructive"
              : "text-muted-foreground"
          }
          loading={loading}
        />
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Acoes Rapidas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Button variant="outline" className="h-auto py-4 flex-col gap-2" asChild>
              <Link href="/hub/produtos?action=pull-eccosys">
                <ArrowDownToLine className="h-5 w-5 text-orange-500" />
                <span className="text-xs">Puxar do Eccosys</span>
              </Link>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex-col gap-2" asChild>
              <Link href="/hub/produtos?action=push-ml">
                <ArrowUpFromLine className="h-5 w-5 text-blue-500" />
                <span className="text-xs">Enviar pro ML</span>
              </Link>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex-col gap-2" asChild>
              <Link href="/hub/produtos?action=pull-ml">
                <ArrowDownToLine className="h-5 w-5 text-yellow-500" />
                <span className="text-xs">Puxar do ML</span>
              </Link>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex-col gap-2" asChild>
              <Link href="/hub/pedidos">
                <ShoppingCart className="h-5 w-5 text-purple-500" />
                <span className="text-xs">Ver Pedidos</span>
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
