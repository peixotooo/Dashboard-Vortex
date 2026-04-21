"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  FlaskConical,
  Inbox,
  Loader2,
  Plus,
  Rocket,
  ShieldAlert,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/lib/workspace-context";
import { DemandCard } from "@/components/mission-control/demand-card";
import { DemandForm } from "@/components/mission-control/demand-form";
import type { Demand, DemandStatus } from "@/lib/mission-control/types";
import { AREAS, PRIORITIES } from "@/lib/mission-control/types";
import { AREA_LABEL } from "@/lib/mission-control/format";

type Summary = {
  counts: {
    total: number;
    open: number;
    waiting_pricila: number;
    blocked: number;
    ready_for_review: number;
    done_today: number;
    follow_ups_pending: number;
    follow_ups_no_reply: number;
  };
  overdueWaitingPricila: Array<{
    id: string;
    title: string;
    owner: string | null;
    overdue_hours: number;
  }>;
  todays: string[];
  weekly: string[];
};

const TAB_META = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "waiting_pricila", label: "Aguardando Pricila", icon: AlertTriangle },
  { key: "blocked", label: "Bloqueados", icon: ShieldAlert },
  { key: "today", label: "Hoje", icon: Calendar },
  { key: "week", label: "Semana", icon: Calendar },
];

export default function MissionControlPage() {
  const { workspace } = useWorkspace();
  const searchParams = useSearchParams();
  const [demands, setDemands] = useState<Demand[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>(
    searchParams?.get("view") ?? "inbox"
  );
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const [dRes, sRes] = await Promise.all([
        fetch("/api/mission-control/demands", {
          headers: { "x-workspace-id": workspace.id },
        }),
        fetch("/api/mission-control/summary", {
          headers: { "x-workspace-id": workspace.id },
        }),
      ]);
      if (dRes.ok) {
        const { demands } = await dRes.json();
        setDemands(demands);
      }
      if (sRes.ok) {
        const { summary } = await sRes.json();
        setSummary(summary);
      }
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const chargePricila = async (id: string) => {
    if (!workspace?.id) return;
    await fetch(`/api/mission-control/demands/${id}/charge-pricila`, {
      method: "POST",
      headers: { "x-workspace-id": workspace.id },
    });
    load();
  };

  const createDemand = async (input: Record<string, unknown>) => {
    if (!workspace?.id) return;
    await fetch("/api/mission-control/demands", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-id": workspace.id,
      },
      body: JSON.stringify(input),
    });
    load();
  };

  const filtered = useMemo(() => {
    const openStatuses: DemandStatus[] = [
      "new",
      "triaged",
      "assigned",
      "waiting_pricila",
      "in_progress",
      "waiting_external",
      "blocked",
      "ready_for_review",
    ];

    let list = demands.slice();
    if (search)
      list = list.filter((d) =>
        d.title.toLowerCase().includes(search.toLowerCase())
      );
    if (areaFilter) list = list.filter((d) => d.area === areaFilter);
    if (priorityFilter) list = list.filter((d) => d.priority === priorityFilter);

    switch (tab) {
      case "inbox":
        return list.filter((d) => openStatuses.includes(d.status));
      case "waiting_pricila":
        return list.filter((d) => d.is_waiting_on_pricila);
      case "blocked":
        return list.filter((d) => d.status === "blocked");
      case "today":
        return list.filter((d) => summary?.todays.includes(d.id));
      case "week":
        return list.filter((d) => summary?.weekly.includes(d.id));
      default:
        return list;
    }
  }, [demands, tab, search, areaFilter, priorityFilter, summary]);

  if (loading && !summary) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Rocket className="h-7 w-7" />
            Mission Control
          </h1>
          <p className="text-muted-foreground mt-1">
            Cerebro operacional do Atlas — demandas, cobrancas, bloqueios, decisoes e aprendizados.
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nova Demanda
        </Button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <KpiCard label="Abertas" value={summary.counts.open} icon={Inbox} />
          <KpiCard
            label="Aguardando Pricila"
            value={summary.counts.waiting_pricila}
            icon={AlertTriangle}
            accent={summary.counts.waiting_pricila > 0 ? "amber" : undefined}
          />
          <KpiCard
            label="Bloqueadas"
            value={summary.counts.blocked}
            icon={ShieldAlert}
            accent={summary.counts.blocked > 0 ? "red" : undefined}
          />
          <KpiCard
            label="Em Revisao"
            value={summary.counts.ready_for_review}
            icon={Target}
          />
          <KpiCard
            label="Concluidas hoje"
            value={summary.counts.done_today}
            icon={Rocket}
            accent="green"
          />
          <KpiCard
            label="Follow-ups pendentes"
            value={summary.counts.follow_ups_pending}
            icon={Users}
          />
          <KpiCard
            label="Sem resposta"
            value={summary.counts.follow_ups_no_reply}
            icon={AlertTriangle}
            accent={summary.counts.follow_ups_no_reply > 0 ? "red" : undefined}
          />
          <KpiCard label="Total" value={summary.counts.total} icon={TrendingUp} />
        </div>
      )}

      {summary && summary.overdueWaitingPricila.length > 0 && (
        <Card className="border-amber-400/50">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" />
              <h3 className="font-semibold text-sm">
                Aguardando Pricila há mais de SLA ({summary.overdueWaitingPricila.length})
              </h3>
            </div>
            <ul className="space-y-1 text-sm">
              {summary.overdueWaitingPricila.slice(0, 5).map((d) => (
                <li key={d.id} className="flex items-center justify-between">
                  <Link href={`/mission-control/${d.id}`} className="hover:underline flex-1 truncate">
                    {d.title}
                  </Link>
                  <span className="text-amber-600 dark:text-amber-400 font-mono text-xs ml-3 shrink-0">
                    {d.overdue_hours}h atrasado
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar demanda..."
          className="max-w-sm"
        />
        <select
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Todas areas</option>
          {AREAS.map((a) => (
            <option key={a} value={a}>
              {AREA_LABEL[a]}
            </option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Todas prioridades</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/mission-control/growth"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <FlaskConical className="h-4 w-4" />
            Growth Board
          </Link>
          <Link
            href="/mission-control/reports"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <TrendingUp className="h-4 w-4" />
            Reports
          </Link>
          <Link
            href="/mission-control/learnings"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <BookOpen className="h-4 w-4" />
            Learnings / Decisions
          </Link>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {TAB_META.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
              <t.icon className="h-4 w-4" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TAB_META.map((t) => (
          <TabsContent key={t.key} value={t.key}>
            {filtered.length === 0 ? (
              <Card>
                <CardContent className="p-10 text-center text-muted-foreground text-sm">
                  Nenhuma demanda nesta view.
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {filtered.map((d) => (
                  <DemandCard
                    key={d.id}
                    demand={d}
                    chargePricila={chargePricila}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <DemandForm
        open={showForm}
        onOpenChange={setShowForm}
        onSubmit={createDemand}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent?: "red" | "amber" | "green";
}) {
  const color =
    accent === "red"
      ? "text-red-600 dark:text-red-400"
      : accent === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : accent === "green"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-foreground";
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <Icon className={`h-4 w-4 ${color}`} />
          <span className={`text-2xl font-bold ${color}`}>{value}</span>
        </div>
        <div className="text-[11px] text-muted-foreground mt-1 leading-tight">
          {label}
        </div>
      </CardContent>
    </Card>
  );
}
