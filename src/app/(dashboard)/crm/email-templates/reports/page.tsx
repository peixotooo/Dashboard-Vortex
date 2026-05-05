"use client";
import { useEffect, useState, useCallback } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Loader2,
  Mail,
  Eye,
  MousePointerClick,
  AlertOctagon,
  TrendingUp,
  Calendar,
  RefreshCw,
} from "lucide-react";
import { SectionNav } from "../_components/section-nav";

interface DispatchRow {
  id: string;
  draft_id: string | null;
  suggestion_id: string | null;
  locaweb_message_id: string;
  locaweb_list_ids: string[];
  scheduled_to: string | null;
  status: string;
  stats: Record<string, unknown> & {
    utm_campaign?: string;
    utm_term?: string | null;
    target_segment?: string | null;
    delivered?: number;
    opens?: number;
    uniq_opens?: number;
    clicks?: number;
    bounces?: number;
    total?: number;
  };
  last_synced_at: string | null;
  created_at: string;
}

interface DispatchDetail {
  dispatch: DispatchRow;
  locaweb: {
    message?: { status?: string; [k: string]: unknown };
    overview?: Record<string, unknown>;
    bounces?: unknown[];
    clicks?: unknown[];
    opens?: unknown[];
  };
  ga4?: {
    campaign?: string;
    sessions?: number;
    users?: number;
    engagement_rate?: number;
    revenue?: number;
    transactions?: number;
    items?: number;
    error?: string;
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

export default function ReportsPage() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? "";
  const [dispatches, setDispatches] = useState<DispatchRow[] | null>(null);
  const [detail, setDetail] = useState<DispatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
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

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const r = await fetch(`/api/crm/email-templates/reports/${id}`, {
        headers: { "x-workspace-id": workspaceId },
      });
      const d = await r.json();
      setDetail(d);
    } finally {
      setDetailLoading(false);
    }
  };

  const triggerRefresh = async () => {
    setRefreshing(true);
    try {
      // The cron endpoint requires the cron secret; instead just re-load the
      // dispatches with whatever the last cron pulled. If nothing fresh, the
      // detail view will hit Locaweb directly when opened.
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  if (!workspaceId) {
    return <div className="p-6 text-muted-foreground">Selecione um workspace.</div>;
  }

  // Aggregate KPIs across all dispatches
  const totals = (dispatches ?? []).reduce(
    (acc, d) => {
      const s = d.stats ?? {};
      acc.sent += Number(s.delivered ?? s.total ?? 0);
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
              Stats de cada campanha disparada via Locaweb + atribuição de receita
              via GA4 (UTM <span className="font-mono">utm_campaign</span> universal).
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
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b">
            <tr className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <th className="text-left px-3 py-2">Quando</th>
              <th className="text-left px-3 py-2">Campanha (UTM)</th>
              <th className="text-left px-3 py-2">Segmento</th>
              <th className="text-right px-3 py-2">Entregues</th>
              <th className="text-right px-3 py-2">Open %</th>
              <th className="text-right px-3 py-2">CTR %</th>
              <th className="text-right px-3 py-2">Bounce %</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {dispatches === null && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                  Carregando...
                </td>
              </tr>
            )}
            {dispatches?.length === 0 && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted-foreground">
                  Nenhuma campanha disparada ainda. Use o botão "Disparar" em
                  qualquer sugestão ou draft pra começar.
                </td>
              </tr>
            )}
            {dispatches?.map((d) => {
              const sent = Number(d.stats?.delivered ?? d.stats?.total ?? 0);
              const opens = Number(d.stats?.uniq_opens ?? d.stats?.opens ?? 0);
              const clicks = Number(d.stats?.clicks ?? 0);
              const bounces = Number(d.stats?.bounces ?? 0);
              return (
                <tr
                  key={d.id}
                  className="border-b hover:bg-muted/30 cursor-pointer"
                  onClick={() => openDetail(d.id)}
                >
                  <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                    <Calendar className="w-3 h-3 inline mr-1" />
                    {fmtDate(d.created_at)}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] truncate max-w-[260px]">
                    {d.stats?.utm_campaign ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-muted-foreground">
                    {(d.stats?.utm_term as string) ??
                      (d.stats?.target_segment as string) ??
                      "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{sent || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {pct(opens, sent)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {pct(clicks, sent)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {pct(bounces, sent)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" className="h-7 text-xs">
                      Detalhes
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Detail drawer */}
      <Sheet
        open={detail !== null || detailLoading}
        onOpenChange={(o) => !o && setDetail(null)}
      >
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetTitle className="text-base">Detalhes da campanha</SheetTitle>
          {detailLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-6">
              <Loader2 className="w-4 h-4 animate-spin" /> Buscando stats live...
            </div>
          )}
          {detail && <DetailView detail={detail} />}
        </SheetContent>
      </Sheet>
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

function DetailView({ detail }: { detail: DispatchDetail }) {
  const d = detail.dispatch;
  const overview = (detail.locaweb?.overview ?? {}) as Record<string, unknown>;
  const ga4 = detail.ga4 ?? {};
  const sent = Number(overview?.delivered ?? overview?.total ?? d.stats?.delivered ?? d.stats?.total ?? 0);
  const opens = Number(overview?.uniq_opens ?? overview?.opens ?? d.stats?.uniq_opens ?? d.stats?.opens ?? 0);
  const clicks = Number(overview?.clicks ?? d.stats?.clicks ?? 0);
  const bounces = Number(overview?.bounces ?? d.stats?.bounces ?? 0);

  return (
    <div className="space-y-5 mt-4">
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          UTM Campaign
        </div>
        <div className="font-mono text-sm break-all">
          {(d.stats?.utm_campaign as string) ?? "—"}
        </div>
        <div className="text-[10px] text-muted-foreground">
          Locaweb message id: <span className="font-mono">{d.locaweb_message_id}</span> ·
          status <StatusBadge status={d.status} />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Kpi icon={<Mail className="w-3.5 h-3.5" />} label="Entregues" value={sent} />
        <Kpi
          icon={<Eye className="w-3.5 h-3.5" />}
          label="Aberturas"
          value={opens}
          sub={pct(opens, sent)}
        />
        <Kpi
          icon={<MousePointerClick className="w-3.5 h-3.5" />}
          label="Cliques"
          value={clicks}
          sub={pct(clicks, sent)}
        />
        <Kpi
          icon={<AlertOctagon className="w-3.5 h-3.5" />}
          label="Bounces"
          value={bounces}
          sub={pct(bounces, sent)}
        />
      </div>

      {/* GA4 attribution */}
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Atribuição GA4 (sessões com utm_campaign correspondente)
        </div>
        {ga4?.error ? (
          <div className="text-xs text-destructive p-2 border border-destructive/30 rounded bg-destructive/5">
            {ga4.error}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <Kpi icon={<TrendingUp className="w-3.5 h-3.5" />} label="Sessões" value={ga4.sessions ?? 0} />
            <Kpi
              icon={<TrendingUp className="w-3.5 h-3.5" />}
              label="Pedidos"
              value={ga4.transactions ?? 0}
            />
            <Kpi
              icon={<TrendingUp className="w-3.5 h-3.5" />}
              label="Receita"
              value={Math.round(ga4.revenue ?? 0)}
              sub={`R$ ${(ga4.revenue ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
            />
          </div>
        )}
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          GA4 captura sessões com {`utm_source=bulking-vortex utm_medium=email`} +
          a campaign acima. Atribuição "last-non-direct" do GA4 — se o cliente
          clicou no email e fechou a compra em outra sessão direta, GA4 ainda
          credita aqui dentro de 30 dias.
        </p>
      </div>

      {/* Lista de listas Locaweb */}
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Listas Locaweb
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {d.locaweb_list_ids.map((id) => (
            <Badge key={id} variant="outline" className="text-[10px] font-mono">
              {id}
            </Badge>
          ))}
        </div>
      </div>

      {/* Top links clicados */}
      {Array.isArray(detail.locaweb?.clicks) && detail.locaweb.clicks.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Links clicados ({detail.locaweb.clicks.length})
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {detail.locaweb.clicks.slice(0, 20).map((c, i) => {
              const click = c as Record<string, unknown>;
              return (
                <div
                  key={i}
                  className="text-[11px] font-mono truncate text-muted-foreground"
                  title={String(click.url ?? click.link ?? "")}
                >
                  {String(click.url ?? click.link ?? click.email ?? JSON.stringify(c).slice(0, 80))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
