"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  Globe,
  Monitor,
  Smartphone,
  ExternalLink,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ActivityEntry, ActivitySource } from "@/lib/types";

const SOURCE_CONFIG: Record<
  ActivitySource,
  {
    label: string;
    icon: typeof Monitor;
    className: string;
    tooltip: string;
  }
> = {
  dashboard: {
    label: "Dashboard",
    icon: Monitor,
    className: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10",
    tooltip: "Alterado pelo Dashboard Vortex",
  },
  "ads-manager": {
    label: "Ads Manager",
    icon: Globe,
    className: "text-blue-500 border-blue-500/30 bg-blue-500/10",
    tooltip: "Alterado via Meta Ads Manager",
  },
  "business-suite": {
    label: "Business Suite",
    icon: Smartphone,
    className: "text-purple-500 border-purple-500/30 bg-purple-500/10",
    tooltip: "Alterado via Meta Business Suite",
  },
  other: {
    label: "Outro",
    icon: ExternalLink,
    className: "text-gray-500 border-gray-500/30 bg-gray-500/10",
    tooltip: "Alterado via aplicativo externo",
  },
};

const OBJECT_TYPE_LABELS: Record<string, string> = {
  CAMPAIGN: "Campanha",
  ADSET: "Conjunto",
  AD_SET: "Conjunto",
  AD: "Anuncio",
  ACCOUNT: "Conta",
};

const CATEGORY_OPTIONS = [
  { value: "all", label: "Todas categorias" },
  { value: "BUDGET", label: "Orcamento" },
  { value: "STATUS", label: "Status" },
  { value: "TARGETING", label: "Segmentacao" },
  { value: "CAMPAIGN", label: "Campanha" },
  { value: "AD_SET", label: "Conjunto de Anuncios" },
  { value: "AD", label: "Anuncios" },
  { value: "AUDIENCE", label: "Publicos" },
  { value: "BID", label: "Lances" },
];

function formatActivityTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 60) return `${diffMins}min atras`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h atras`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d atras`;

    return date.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

interface ActivityHistoryProps {
  accountId: string;
  workspaceId: string;
}

export function ActivityHistory({
  accountId,
  workspaceId,
}: ActivityHistoryProps) {
  const [open, setOpen] = useState(false);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState("7d");
  const [category, setCategory] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<ActivitySource | "all">(
    "all"
  );

  const fetchActivities = useCallback(async () => {
    if (!accountId || accountId === "all") return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        account_id: accountId,
        period,
      });
      if (category !== "all") params.set("category", category);

      const res = await fetch(`/api/campaigns/activities?${params}`, {
        headers: { "x-workspace-id": workspaceId },
      });
      const data = await res.json();
      setActivities(data.activities || []);
    } catch {
      // graceful fallback
    } finally {
      setLoading(false);
    }
  }, [accountId, workspaceId, period, category]);

  useEffect(() => {
    if (open) fetchActivities();
  }, [open, fetchActivities]);

  const filtered =
    sourceFilter === "all"
      ? activities
      : activities.filter((a) => a.source === sourceFilter);

  const sourceCounts = {
    dashboard: activities.filter((a) => a.source === "dashboard").length,
    "ads-manager": activities.filter((a) => a.source === "ads-manager").length,
    "business-suite": activities.filter((a) => a.source === "business-suite")
      .length,
    other: activities.filter((a) => a.source === "other").length,
  };

  return (
    <div className="border rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        <History className="h-4 w-4 text-muted-foreground" />
        Historico de Alteracoes
        {activities.length > 0 && (
          <Badge variant="secondary" className="text-[10px] h-5 ml-1">
            {activities.length}
          </Badge>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t">
          {/* Controls row */}
          <div className="flex items-center gap-2 pt-3 flex-wrap">
            {(["7d", "30d", "90d"] as const).map((p) => (
              <Button
                key={p}
                variant={period === p ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPeriod(p)}
              >
                {p === "7d" ? "7 dias" : p === "30d" ? "30 dias" : "90 dias"}
              </Button>
            ))}

            <div className="w-px h-5 bg-border mx-1" />

            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-44 h-7 text-xs">
                <Filter className="h-3 w-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {loading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Source filter chips */}
          <div className="flex items-center gap-1 flex-wrap">
            <Button
              variant={sourceFilter === "all" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 text-[11px] px-2"
              onClick={() => setSourceFilter("all")}
            >
              Todas ({activities.length})
            </Button>
            {(
              Object.entries(SOURCE_CONFIG) as [
                ActivitySource,
                (typeof SOURCE_CONFIG)[ActivitySource],
              ][]
            ).map(([key, config]) => {
              const count = sourceCounts[key];
              if (count === 0) return null;
              const Icon = config.icon;
              return (
                <Button
                  key={key}
                  variant={sourceFilter === key ? "secondary" : "ghost"}
                  size="sm"
                  className="h-6 text-[11px] px-2 gap-1"
                  onClick={() => setSourceFilter(key)}
                >
                  <Icon className="h-3 w-3" />
                  {config.label} ({count})
                </Button>
              );
            })}
          </div>

          {/* KPI mini-cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border bg-card p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Total alteracoes
              </p>
              <p className="text-lg font-bold mt-1">{activities.length}</p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Monitor className="h-3 w-3" /> Dashboard
              </p>
              <p className="text-lg font-bold mt-1">
                {sourceCounts.dashboard}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Globe className="h-3 w-3" /> Ads Manager
              </p>
              <p className="text-lg font-bold mt-1">
                {sourceCounts["ads-manager"]}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Smartphone className="h-3 w-3" /> Business Suite
              </p>
              <p className="text-lg font-bold mt-1">
                {sourceCounts["business-suite"]}
              </p>
            </div>
          </div>

          {/* Activity Timeline */}
          {filtered.length === 0 && !loading && (
            <p className="text-xs text-muted-foreground text-center py-4">
              Nenhuma alteracao encontrada neste periodo.
            </p>
          )}

          {filtered.length > 0 && (
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {filtered.map((activity, i) => {
                const sourceConfig = SOURCE_CONFIG[activity.source];
                const SourceIcon = sourceConfig.icon;
                const objectLabel =
                  OBJECT_TYPE_LABELS[activity.object_type] ||
                  activity.object_type;

                return (
                  <div
                    key={`${activity.object_id}-${activity.event_time}-${i}`}
                    className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 text-sm"
                  >
                    {/* Source icon */}
                    <Tooltip>
                      <TooltipTrigger>
                        <SourceIcon
                          className={`h-4 w-4 shrink-0 mt-0.5 ${sourceConfig.className.split(" ")[0]}`}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        {sourceConfig.tooltip}
                      </TooltipContent>
                    </Tooltip>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge
                          variant="outline"
                          className="text-[10px] h-5 shrink-0"
                        >
                          {objectLabel}
                        </Badge>
                        <span className="text-xs font-medium truncate">
                          {activity.object_name}
                        </span>
                      </div>

                      <p className="text-xs text-muted-foreground mt-0.5">
                        {activity.change_description}
                      </p>

                      {activity.old_value && activity.new_value && (
                        <p className="text-xs mt-0.5">
                          <span className="text-red-500 line-through">
                            {activity.old_value}
                          </span>
                          {" \u2192 "}
                          <span className="text-emerald-500">
                            {activity.new_value}
                          </span>
                        </p>
                      )}
                    </div>

                    {/* Source badge + actor + timestamp */}
                    <div className="text-right shrink-0">
                      <Badge
                        variant="outline"
                        className={`text-[10px] h-5 ${sourceConfig.className}`}
                      >
                        {sourceConfig.label}
                      </Badge>
                      <p className="text-[10px] text-muted-foreground mt-1 font-medium">
                        {activity.actor_name}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {formatActivityTime(
                          activity.date_time_in_timezone ||
                            activity.event_time
                        )}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
