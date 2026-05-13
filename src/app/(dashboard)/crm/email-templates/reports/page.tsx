"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/lib/workspace-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Mail,
  Eye,
  MousePointerClick,
  AlertOctagon,
  TrendingUp,
  Calendar,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import { SectionNav } from "../_components/section-nav";

interface DispatchRow {
  id: string;
  provider: "locaweb" | "iporto" | string;
  subject: string | null;
  status: string;
  scheduled_to: string | null;
  created_at: string;
  last_synced_at: string | null;
  recipients_total: number | null;
  recipients_sent: number | null;
  recipients_failed: number | null;
  locaweb_message_id: string | null;
  locaweb_list_ids: string[];
  audience_lists: Array<{ list_id: string; name: string; count: number | null }>;
  suggestion_id: string | null;
  draft_id: string | null;
  stats: Record<string, unknown> & {
    utm_campaign?: string | null;
    utm_term?: string | null;
    target_segment?: string | null;
    delivered?: number;
    opens?: number;
    uniq_opens?: number;
    clicks?: number;
    bounces?: number;
    total?: number;
  };
}

function pct(n: number | undefined, d: number | undefined): string {
  if (!n || !d) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    pending_approval: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    queued: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    scheduled: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    sending: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
    sent: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    failed: "bg-destructive/15 text-destructive",
    canceled: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-widest ${map[status] ?? "bg-muted"}`}>
      {status}
    </span>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const isIporto = provider === "iporto";
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-widest ${
        isIporto
          ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
          : "bg-sky-500/15 text-sky-700 dark:text-sky-300"
      }`}
    >
      {isIporto ? "iPORTO" : "Locaweb"}
    </span>
  );
}

export default function ReportsPage() {
  const router = useRouter();
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? "";
  const [dispatches, setDispatches] = useState<DispatchRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setDispatches(null);
    const r = await fetch("/api/crm/email-templates/reports?days=60", {
      headers: { "x-workspace-id": workspaceId },
    });
    const d = await r.json();
    setDispatches(d.dispatches ?? []);
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const triggerRefresh = async () => {
    setRefreshing(true);
    try {
      // Workspace-scoped manual sync: puxa overview/status freshes da
      // Locaweb pra cada dispatch (iPORTO atualiza via webhook, então sync
      // só vale pra rows locaweb). Re-fetch da lista após o sync.
      await fetch("/api/crm/email-templates/reports/sync", {
        method: "POST",
        headers: { "x-workspace-id": workspaceId },
      }).catch(() => null);
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  if (!workspaceId) {
    return <div className="p-6 text-muted-foreground">Selecione um workspace.</div>;
  }

  // KPIs agregados — soma delivered/opens/clicks/bounces de todos os rows.
  const totals = (dispatches ?? []).reduce(
    (acc, d) => {
      const s = d.stats ?? {};
      acc.sent += Number(s.delivered ?? s.total ?? d.recipients_sent ?? 0);
      acc.opens += Number(s.uniq_opens ?? s.opens ?? 0);
      acc.clicks += Number(s.clicks ?? 0);
      acc.bounces += Number(s.bounces ?? 0);
      acc.dispatches += 1;
      return acc;
    },
    { sent: 0, opens: 0, clicks: 0, bounces: 0, dispatches: 0 }
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="space-y-3">
        <SectionNav />
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Relatórios</h1>
            <p className="text-muted-foreground text-sm">
              Stats de cada campanha disparada (Locaweb · iPORTO) + atribuição de
              receita via GA4 (UTM <span className="font-mono">utm_campaign</span>).
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={triggerRefresh}
            disabled={refreshing}
            className="gap-1.5"
          >
            {refreshing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Atualizar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi icon={<Mail className="w-4 h-4" />} label="Campanhas" value={totals.dispatches} />
        <Kpi icon={<TrendingUp className="w-4 h-4" />} label="Entregues" value={totals.sent} />
        <Kpi
          icon={<Eye className="w-4 h-4" />}
          label="Aberturas"
          value={totals.opens}
          sub={`taxa ${pct(totals.opens, totals.sent)}`}
        />
        <Kpi
          icon={<MousePointerClick className="w-4 h-4" />}
          label="Cliques"
          value={totals.clicks}
          sub={`CTR ${pct(totals.clicks, totals.sent)}`}
        />
        <Kpi
          icon={<AlertOctagon className="w-4 h-4" />}
          label="Bounces"
          value={totals.bounces}
          sub={`taxa ${pct(totals.bounces, totals.sent)}`}
        />
      </div>

      {/* Lista de dispatches */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="text-left px-3 py-2">Quando</th>
                <th className="text-left px-3 py-2">Provedor</th>
                <th className="text-left px-3 py-2">Assunto / UTM</th>
                <th className="text-left px-3 py-2">Audiência</th>
                <th className="text-right px-3 py-2">Destinatários</th>
                <th className="text-right px-3 py-2">Entregues</th>
                <th className="text-right px-3 py-2">Open %</th>
                <th className="text-right px-3 py-2">CTR %</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {dispatches === null && (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                    Carregando...
                  </td>
                </tr>
              )}
              {dispatches?.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-muted-foreground">
                    Nenhuma campanha disparada ainda. Use o botão "Disparar" em
                    qualquer sugestão ou draft pra começar.
                  </td>
                </tr>
              )}
              {dispatches?.map((d) => {
                const sent = Number(
                  d.stats?.delivered ?? d.stats?.total ?? d.recipients_sent ?? 0
                );
                const opens = Number(d.stats?.uniq_opens ?? d.stats?.opens ?? 0);
                const clicks = Number(d.stats?.clicks ?? 0);
                const recipientsTotal = d.recipients_total ?? null;
                const audienceLabel =
                  d.audience_lists.length > 0
                    ? d.audience_lists.map((a) => a.name).join(" + ")
                    : (d.stats?.target_segment as string) ??
                      (d.stats?.utm_term as string) ??
                      "—";
                return (
                  <tr
                    key={d.id}
                    className="border-b hover:bg-muted/30 cursor-pointer"
                    onClick={() => router.push(`/crm/email-templates/reports/${d.id}`)}
                  >
                    <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                      <Calendar className="w-3 h-3 inline mr-1" />
                      {fmtDate(d.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      <ProviderBadge provider={d.provider} />
                    </td>
                    <td className="px-3 py-2 max-w-[280px]">
                      <div className="truncate font-medium text-[12px]">
                        {d.subject ?? "—"}
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {d.stats?.utm_campaign ?? "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground max-w-[180px] truncate">
                      {audienceLabel}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[11px]">
                      {recipientsTotal !== null
                        ? recipientsTotal.toLocaleString("pt-BR")
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {sent ? sent.toLocaleString("pt-BR") : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {pct(opens, sent || (recipientsTotal ?? 0))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {pct(clicks, sent || (recipientsTotal ?? 0))}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <ChevronRight className="w-4 h-4 text-muted-foreground inline" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <Card className="p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums">{value.toLocaleString("pt-BR")}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}
