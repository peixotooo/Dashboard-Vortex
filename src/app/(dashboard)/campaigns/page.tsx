"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  Plus,
  Pause,
  Play,
  Trash2,
  Megaphone,
  DollarSign,
  Target,
  MousePointerClick,
  ArrowUpDown,
  Trophy,
  Zap,
  BarChart3,
  Loader2,
  TrendingUp,
  AlertTriangle,
  OctagonX,
  Settings2,
  Lightbulb,
  X,
  Check,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  Clock,
  History,
  ChevronDown,
  ChevronRight,
  Monitor,
  Globe,
  BrainCircuit,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBudget, formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";
import { useWorkspace } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth-context";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PerformanceTable } from "@/components/dashboard/performance-table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import type { DatePreset, CampaignWithMetrics, BudgetLogEntry, OptimizationScores, CooldownInfo, ActivityEntry } from "@/lib/types";
import { ActivityHistory } from "@/components/campaigns/activity-history";

const TIER_CONFIG = {
  champion: { label: "Escalar", description: "ROAS acima de 1.5x a media e alto investimento. Aumente o budget — esta gerando muito retorno com volume.", icon: Trophy, className: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10" },
  potential: { label: "Aumentar", description: "ROAS acima de 1.5x a media, mas investimento baixo. Suba o budget para capturar mais resultado com esse ROAS alto.", icon: Zap, className: "text-blue-500 border-blue-500/30 bg-blue-500/10" },
  scale: { label: "Manter", description: "Alto investimento com retorno positivo (ROAS >= 1.0). Mantenha o budget atual e monitore variacoes.", icon: BarChart3, className: "text-purple-500 border-purple-500/30 bg-purple-500/10" },
  profitable: { label: "Otimizar", description: "ROAS positivo mas abaixo da media. Teste novos criativos, copys ou publicos para melhorar o retorno.", icon: TrendingUp, className: "text-cyan-500 border-cyan-500/30 bg-cyan-500/10" },
  warning: { label: "Revisar", description: "ROAS abaixo de 1.0 — gasta mais do que retorna. Revise segmentacao, criativos e landing page urgente.", icon: AlertTriangle, className: "text-amber-500 border-amber-500/30 bg-amber-500/10" },
  critical: { label: "Pausar", description: "Investimento sem nenhum retorno (ROAS zero). Pause imediatamente e reestruture antes de gastar mais.", icon: OctagonX, className: "text-red-500 border-red-500/30 bg-red-500/10" },
} as const;

function TierBadge({ tier }: { tier?: string | null }) {
  if (!tier || !(tier in TIER_CONFIG)) return null;
  const config = TIER_CONFIG[tier as keyof typeof TIER_CONFIG];
  const Icon = config.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`text-xs gap-1 cursor-help ${config.className}`}>
          <Icon className="h-3 w-3" />
          {config.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] text-xs">
        {config.description}
      </TooltipContent>
    </Tooltip>
  );
}

function getSuggestion(c: CampaignWithMetrics): { pct: number; label: string } {
  switch (c.tier) {
    case "champion": return { pct: 20, label: "Escalar" };
    case "potential": return { pct: 20, label: "Aumentar" };
    case "scale": return { pct: 0, label: "Manter" };
    case "profitable": return { pct: 10, label: "Aumento cauteloso" };
    case "warning": return { pct: -15, label: "Reduzir" };
    case "critical": return { pct: -50, label: "Reduzir urgente" };
    default: return { pct: 0, label: "Sem sugestao" };
  }
}

function getRiskZone(pct: number): { label: string; color: string; icon: typeof ShieldCheck } {
  const absPct = Math.abs(pct);
  if (absPct <= 20) return { label: "Zona segura", color: "text-emerald-500", icon: ShieldCheck };
  if (absPct <= 30) return { label: "Cuidado", color: "text-amber-500", icon: AlertCircle };
  return { label: "Alto risco", color: "text-red-500", icon: ShieldAlert };
}

function evaluateSmartness(tier: string | null | undefined, changePct: number): boolean {
  const isIncrease = changePct > 0;
  const isScaleTier = ["champion", "potential", "scale"].includes(tier || "");
  const isReduceTier = ["warning", "critical"].includes(tier || "");
  if (Math.abs(changePct) > 20) return false; // resets learning phase
  if (isScaleTier && isIncrease) return true;
  if (isReduceTier && !isIncrease) return true;
  return false;
}

function computeRiskLevel(changePct: number): "low" | "medium" | "high" {
  const abs = Math.abs(changePct);
  if (abs <= 10) return "low";
  if (abs <= 20) return "medium";
  return "high";
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}min atras`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atras`;
  const days = Math.floor(hours / 24);
  return `${days}d atras`;
}

function parseBudgetCents(c: CampaignWithMetrics): number {
  return parseInt(String(c.daily_budget || "0"), 10);
}

function hasDailyBudget(c: CampaignWithMetrics): boolean {
  return !!c.daily_budget && parseInt(String(c.daily_budget), 10) > 0;
}

export default function CampaignsPage() {
  const { accountId, accounts } = useAccount();
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const [datePreset, setDatePreset] = useState<DatePreset>("last_30d");
  const [campaigns, setCampaigns] = useState<CampaignWithMetrics[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<{ total: number; loaded: number } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [tierFilter, setTierFilter] = useState("all");
  const [pageAccountFilter, setPageAccountFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "ACTIVE" | "PAUSED">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false);
  const [budgetDialogCampaigns, setBudgetDialogCampaigns] = useState<CampaignWithMetrics[]>([]);
  const [budgetPct, setBudgetPct] = useState(0);
  const [budgetMode, setBudgetMode] = useState<"percent" | "fixed">("percent");
  const [budgetFixedValue, setBudgetFixedValue] = useState("");
  const [budgetOverrides, setBudgetOverrides] = useState<Map<string, number>>(new Map());
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetResults, setBudgetResults] = useState<Array<{ id: string; success: boolean; error?: string }> | null>(null);
  // Cooldown: campaign_id -> { at, source, actor } (localStorage-first)
  const [budgetCooldowns, setBudgetCooldowns] = useState<Map<string, CooldownInfo>>(new Map());
  // Optimization history
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLogs, setHistoryLogs] = useState<BudgetLogEntry[]>([]);
  const [historyScores, setHistoryScores] = useState<OptimizationScores | null>(null);
  const [historyPeriod, setHistoryPeriod] = useState("7d");
  const [historyLoading, setHistoryLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const COOLDOWN_HOURS = 24;
  const LS_KEY = "vortex_budget_cooldowns";

  function loadCooldownsFromStorage(): Map<string, CooldownInfo> {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return new Map();
      const parsed = JSON.parse(raw) as Record<string, CooldownInfo | string>;
      const map = new Map<string, CooldownInfo>();
      const cutoff = Date.now() - 48 * 60 * 60 * 1000; // clean entries older than 48h
      for (const [id, val] of Object.entries(parsed)) {
        // Backwards compat: old format was just a timestamp string
        const info: CooldownInfo = typeof val === "string" ? { at: val, source: "dashboard" } : val;
        if (new Date(info.at).getTime() > cutoff) map.set(id, info);
      }
      return map;
    } catch { return new Map(); }
  }

  function saveCooldownsToStorage(map: Map<string, CooldownInfo>) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(map)));
    } catch { /* quota exceeded or SSR */ }
  }

  function recordCooldowns(campaignIds: string[], source: CooldownInfo["source"] = "dashboard", actor?: string) {
    const now = new Date().toISOString();
    setBudgetCooldowns((prev) => {
      const next = new Map(prev);
      for (const id of campaignIds) next.set(id, { at: now, source, actor: actor || user?.email?.split("@")[0] });
      saveCooldownsToStorage(next);
      return next;
    });
  }

  function getCooldownInfo(campaignId: string): { inCooldown: boolean; hoursAgo: number; label: string; source: string; actor?: string } | null {
    const info = budgetCooldowns.get(campaignId);
    if (!info) return null;
    const hoursAgo = (Date.now() - new Date(info.at).getTime()) / (1000 * 60 * 60);
    const inCooldown = hoursAgo < COOLDOWN_HOURS;
    const hoursLeft = Math.ceil(COOLDOWN_HOURS - hoursAgo);
    const sourceLabel = info.source === "dashboard" ? "Dashboard" : info.source === "ads-manager" ? "Ads Manager" : info.source === "business-suite" ? "Business Suite" : "externamente";
    const actorStr = info.actor ? ` por ${info.actor}` : "";
    const label = inCooldown
      ? `Alterado ha ${Math.floor(hoursAgo)}h${actorStr} via ${sourceLabel} — aguarde mais ${hoursLeft}h`
      : `Ultimo ajuste ha ${Math.floor(hoursAgo)}h${actorStr} via ${sourceLabel}`;
    return { inCooldown, hoursAgo, label, source: info.source, actor: info.actor };
  }

  const fetchCampaigns = useCallback(async () => {
    if (!accountId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const accountIds =
      accountId === "all" ? accounts.map((a) => a.id) : [accountId];
    const isMulti = accountIds.length > 1;

    setCampaigns([]);
    setInitialLoading(true);
    setLoadingProgress(isMulti ? { total: accountIds.length, loaded: 0 } : null);

    const headers: Record<string, string> = {};
    if (workspace?.id) {
      headers["x-workspace-id"] = workspace.id;
    }

    if (isMulti) {
      const promises = accountIds.map(async (id) => {
        try {
          const res = await fetch(
            `/api/campaigns?account_id=${id}&date_preset=${datePreset}&statuses=ACTIVE,PAUSED`,
            { headers, signal: controller.signal }
          );
          const data = await res.json();
          const name = accounts.find((a) => a.id === id)?.name || id;
          const enriched = (data.campaigns || []).map((c: CampaignWithMetrics) => ({
            ...c,
            account_id: id,
            account_name: name,
          }));

          setCampaigns((prev) => [...prev, ...enriched]);
          setInitialLoading(false);
          setLoadingProgress((prev) =>
            prev ? { ...prev, loaded: prev.loaded + 1 } : null
          );
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setLoadingProgress((prev) =>
            prev ? { ...prev, loaded: prev.loaded + 1 } : null
          );
        }
      });

      await Promise.all(promises);
      setLoadingProgress(null);
      setInitialLoading(false);
    } else {
      try {
        const res = await fetch(
          `/api/campaigns?account_id=${accountIds[0]}&date_preset=${datePreset}&statuses=ACTIVE,PAUSED`,
          { headers, signal: controller.signal }
        );
        const data = await res.json();
        setCampaigns(data.campaigns || []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      } finally {
        setInitialLoading(false);
      }
    }
  }, [accountId, accounts, datePreset, workspace?.id]);

  useEffect(() => {
    fetchCampaigns();
    return () => { abortRef.current?.abort(); };
  }, [fetchCampaigns]);

  // Load cooldowns from localStorage on mount + merge with server data
  useEffect(() => {
    const local = loadCooldownsFromStorage();
    setBudgetCooldowns(local);
  }, []);

  // Also try to fetch from server (budget-logs + activities API for external cooldowns)
  useEffect(() => {
    if (campaigns.length === 0 || !workspace?.id) return;
    const ids = campaigns.map((c) => c.id).join(",");

    // 1. Budget logs (existing)
    fetch(`/api/campaigns/budget-logs?campaign_ids=${ids}`, {
      headers: { "x-workspace-id": workspace.id },
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.logs || data.logs.length === 0) return;
        setBudgetCooldowns((prev) => {
          const merged = new Map(prev);
          for (const log of data.logs) {
            const existing = merged.get(log.campaign_id);
            if (!existing || new Date(log.created_at) > new Date(existing.at)) {
              merged.set(log.campaign_id, {
                at: log.created_at,
                source: log.source === "external" ? "ads-manager" : "dashboard",
                actor: log.adjusted_by_email?.split("@")[0],
              });
            }
          }
          saveCooldownsToStorage(merged);
          return merged;
        });
      })
      .catch(() => {});

    // 2. Activities API — detect external budget/status changes in last 24h
    if (accountId && accountId !== "all") {
      fetch(`/api/campaigns/activities?account_id=${accountId}&period=7d&category=BUDGET`, {
        headers: { "x-workspace-id": workspace.id },
      })
        .then((r) => r.json())
        .then((data) => {
          const activities = (data.activities || []) as ActivityEntry[];
          if (activities.length === 0) return;
          const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
          // Build a name→id map from loaded campaigns
          const nameToId = new Map<string, string>();
          for (const c of campaigns) nameToId.set(c.name, c.id);

          setBudgetCooldowns((prev) => {
            const merged = new Map(prev);
            for (const act of activities) {
              if (act.source === "dashboard") continue; // skip our own changes
              const actTime = new Date(act.event_time).getTime();
              if (actTime < cutoff24h) continue;
              // Try to match campaign by object_id or object_name
              let campaignId = act.object_type === "CAMPAIGN" ? act.object_id : "";
              if (!campaignId) campaignId = nameToId.get(act.object_name) || "";
              if (!campaignId) continue;
              const existing = merged.get(campaignId);
              if (!existing || new Date(act.event_time) > new Date(existing.at)) {
                merged.set(campaignId, {
                  at: act.event_time,
                  source: act.source,
                  actor: act.actor_name,
                });
              }
            }
            saveCooldownsToStorage(merged);
            return merged;
          });
        })
        .catch(() => {});
    }
  }, [campaigns, workspace?.id, accountId]);

  // Fetch optimization history when section is opened
  const fetchHistory = useCallback(async () => {
    if (!workspace?.id) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(
        `/api/campaigns/budget-logs?period=${historyPeriod}&include_scores=true`,
        { headers: { "x-workspace-id": workspace.id } }
      );
      const data = await res.json();
      setHistoryLogs(data.logs || []);
      setHistoryScores(data.scores || null);
    } catch {
      // graceful fallback
    } finally {
      setHistoryLoading(false);
    }
  }, [workspace?.id, historyPeriod]);

  useEffect(() => {
    if (historyOpen) fetchHistory();
  }, [historyOpen, fetchHistory]);

  async function handleAction(action: string, campaignId: string) {
    setActionLoading(campaignId);
    try {
      await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, campaign_id: campaignId }),
      });
      await fetchCampaigns();
    } catch {
      // Error handling
    } finally {
      setActionLoading(null);
    }
  }

  function openBudgetDialog(targets: CampaignWithMetrics[]) {
    const valid = targets.filter((c) => hasDailyBudget(c));
    if (valid.length === 0) return;
    setBudgetDialogCampaigns(valid);
    setBudgetMode("percent");
    setBudgetFixedValue("");
    setBudgetOverrides(new Map());
    setBudgetResults(null);

    // Auto-aplicar sugestao para campanha individual
    if (valid.length === 1 && valid[0].tier) {
      const suggestion = getSuggestion(valid[0]);
      setBudgetPct(suggestion.pct);
    } else {
      setBudgetPct(0);
    }

    setBudgetDialogOpen(true);
  }

  function applyTierSuggestions() {
    const overrides = new Map<string, number>();
    for (const c of budgetDialogCampaigns) {
      const suggestion = getSuggestion(c);
      const current = parseBudgetCents(c);
      const newBudget = Math.max(100, Math.round(current * (1 + suggestion.pct / 100)));
      overrides.set(c.id, newBudget);
    }
    setBudgetOverrides(overrides);
    setBudgetMode("percent");
    setBudgetPct(0); // overrides take precedence
  }

  function getNewBudget(c: CampaignWithMetrics): number {
    if (budgetOverrides.has(c.id)) return budgetOverrides.get(c.id)!;
    const current = parseBudgetCents(c);
    if (budgetMode === "fixed") {
      const fixedCents = Math.round(parseFloat(budgetFixedValue || "0") * 100);
      return Math.max(100, fixedCents);
    }
    return Math.max(100, Math.round(current * (1 + budgetPct / 100)));
  }

  function getChangePct(c: CampaignWithMetrics): number {
    const current = parseBudgetCents(c);
    if (current === 0) return 0;
    const newB = getNewBudget(c);
    return ((newB - current) / current) * 100;
  }

  async function handleBudgetConfirm() {
    setBudgetSaving(true);
    setBudgetResults(null);
    const updates = budgetDialogCampaigns.map((c) => ({
      campaign_id: c.id,
      daily_budget: getNewBudget(c),
    }));

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (workspace?.id) headers["x-workspace-id"] = workspace.id;

    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "update_budgets", campaign_updates: updates }),
      });
      const data = await res.json();
      setBudgetResults(data.results || []);
      const allOk = (data.results || []).every((r: { success: boolean }) => r.success);
      if (allOk) {
        // Record cooldowns in localStorage immediately
        recordCooldowns(budgetDialogCampaigns.map((c) => c.id));

        // Also log to server (fire-and-forget, works when table exists)
        const logEntries = budgetDialogCampaigns.map((c) => {
          const pct = getChangePct(c);
          return {
            campaign_id: c.id,
            campaign_name: c.name,
            old_budget: parseBudgetCents(c),
            new_budget: getNewBudget(c),
            change_pct: pct,
            tier: c.tier || undefined,
            source: "dashboard",
            spend_at_time: c.spend ? Math.round(c.spend * 100) : undefined,
            roas_at_time: c.roas || undefined,
            was_smart: evaluateSmartness(c.tier, pct),
            risk_level: computeRiskLevel(pct),
            adjusted_by: user?.id || undefined,
            adjusted_by_email: user?.email || undefined,
          };
        });
        fetch("/api/campaigns/budget-logs", {
          method: "POST",
          headers,
          body: JSON.stringify({ logs: logEntries }),
        }).catch(() => {});

        // Update local history immediately
        const now = new Date().toISOString();
        setHistoryLogs((prev) => [
          ...logEntries.map((l) => ({ ...l, source: "dashboard" as const, created_at: now, adjusted_by_email: user?.email || undefined })),
          ...prev,
        ]);

        setTimeout(() => {
          setBudgetDialogOpen(false);
          setSelected(new Set());
          fetchCampaigns();
        }, 1500);
      }
    } catch {
      setBudgetResults([{ id: "error", success: false, error: "Erro de rede" }]);
    } finally {
      setBudgetSaving(false);
    }
  }

  // Filter by page account
  const accountFiltered = useMemo(
    () =>
      pageAccountFilter === "all"
        ? campaigns
        : campaigns.filter((c) => c.account_id === pageAccountFilter),
    [campaigns, pageAccountFilter]
  );

  // Filter by status
  const statusFiltered = useMemo(
    () =>
      statusFilter === "all"
        ? accountFiltered
        : accountFiltered.filter((c) => c.status === statusFilter),
    [accountFiltered, statusFilter]
  );

  // Filter by name
  const filtered = useMemo(
    () =>
      statusFiltered.filter((c) =>
        c.name?.toLowerCase().includes(filter.toLowerCase())
      ),
    [statusFiltered, filter]
  );

  // Filter by tier
  const tierFiltered = useMemo(
    () =>
      tierFilter === "all"
        ? filtered
        : filtered.filter((c) => c.tier === tierFilter),
    [filtered, tierFilter]
  );

  // Sorting — ACTIVE first, then by user-chosen sort key
  const sorted = useMemo(() => {
    return [...tierFiltered].sort((a, b) => {
      // Primary: ACTIVE before PAUSED
      const aActive = a.status === "ACTIVE" ? 0 : 1;
      const bActive = b.status === "ACTIVE" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;

      // Secondary: user-chosen sort key
      const getSortVal = (c: CampaignWithMetrics) => {
        if (sortKey === "cps") return c.purchases > 0 ? c.spend / c.purchases : Infinity;
        const v = (c as unknown as Record<string, unknown>)[sortKey] ?? 0;
        return typeof v === "number" ? v : parseFloat(String(v)) || 0;
      };
      const aNum = getSortVal(a);
      const bNum = getSortVal(b);
      return sortDir === "desc" ? bNum - aNum : aNum - bNum;
    });
  }, [tierFiltered, sortKey, sortDir]);

  // Selectable campaigns = with daily_budget
  const selectableCampaigns = useMemo(
    () => sorted.filter((c) => hasDailyBudget(c)),
    [sorted]
  );

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === selectableCampaigns.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableCampaigns.map((c) => c.id)));
    }
  }

  // Tier counts
  const tierCounts = useMemo(() => ({
    champion: filtered.filter((c) => c.tier === "champion").length,
    potential: filtered.filter((c) => c.tier === "potential").length,
    scale: filtered.filter((c) => c.tier === "scale").length,
    profitable: filtered.filter((c) => c.tier === "profitable").length,
    warning: filtered.filter((c) => c.tier === "warning").length,
    critical: filtered.filter((c) => c.tier === "critical").length,
  }), [filtered]);

  // KPIs
  const totalCampaigns = filtered.length;
  const totalSpend = filtered.reduce((s, c) => s + c.spend, 0);
  const totalRevenue = filtered.reduce((s, c) => s + c.revenue, 0);
  const totalImpressions = filtered.reduce((s, c) => s + c.impressions, 0);
  const totalClicks = filtered.reduce((s, c) => s + c.clicks, 0);
  const avgRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  const columns = [
    {
      key: "_select",
      label: "",
      render: (_val: unknown, row: Record<string, unknown>) => {
        const canSelect = hasDailyBudget(row as unknown as CampaignWithMetrics);
        if (!canSelect) return <div className="w-4" />;
        return (
          <input
            type="checkbox"
            checked={selected.has(String(row.id))}
            onChange={(e) => { e.stopPropagation(); toggleSelect(String(row.id)); }}
            className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
          />
        );
      },
    },
    {
      key: "name",
      label: "Campanha",
      render: (val: unknown, row: Record<string, unknown>) => (
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium">{String(val)}</p>
            <TierBadge tier={row.tier as string} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {String(row.objective || "").replace("OUTCOME_", "")}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      format: "status" as const,
    },
    // Account column (multi-account only)
    ...(accountId === "all"
      ? [
          {
            key: "account_name",
            label: "Conta",
            render: (val: unknown) => (
              <Badge variant="outline" className="text-xs">
                {String(val || "")}
              </Badge>
            ),
          },
        ]
      : []),
    {
      key: "daily_budget",
      label: "Orcamento",
      align: "right" as const,
      render: (_val: unknown, row: Record<string, unknown>) => {
        const c = row as unknown as CampaignWithMetrics;
        const hasBudget = hasDailyBudget(c);
        const budgetCents = parseBudgetCents(c);
        const spendPct = hasBudget && budgetCents > 0 ? Math.min(100, (c.spend / (budgetCents / 100)) * 100) : 0;

        // Bar + hint color based on tier
        const suggestion = c.tier ? getSuggestion(c) : null;
        const tierBarColor = (() => {
          switch (c.tier) {
            case "champion": return "bg-emerald-500";
            case "potential": return "bg-blue-500";
            case "scale": return "bg-purple-400";
            case "profitable": return "bg-cyan-400";
            case "warning": return "bg-amber-500";
            case "critical": return "bg-red-500";
            default: return "bg-muted-foreground/40";
          }
        })();
        const tierHintColor = (() => {
          switch (c.tier) {
            case "champion": return "text-emerald-500";
            case "potential": return "text-blue-500";
            case "warning": return "text-amber-500";
            case "critical": return "text-red-500";
            default: return "text-muted-foreground";
          }
        })();

        return (
          <div className="text-right min-w-[120px]">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (hasBudget) openBudgetDialog([c]);
              }}
              disabled={!hasBudget}
              className={`text-sm ${hasBudget ? "hover:text-primary hover:underline cursor-pointer" : ""}`}
            >
              {c.daily_budget
                ? `${formatBudget(String(c.daily_budget))}/dia`
                : c.lifetime_budget
                ? formatBudget(String(c.lifetime_budget))
                : "-"}
            </button>
            {hasBudget && spendPct > 0 && (
              <div className="w-full h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${tierBarColor}`}
                  style={{ width: `${spendPct}%` }}
                />
              </div>
            )}
            {hasBudget && suggestion && suggestion.pct !== 0 && (() => {
              const cooldown = getCooldownInfo(c.id);
              if (cooldown?.inCooldown) return null; // hide suggestion during cooldown
              return (
                <p className={`text-[10px] font-medium mt-0.5 ${tierHintColor}`}>
                  {suggestion.pct > 0 ? "↑" : "↓"} {suggestion.label} ({suggestion.pct > 0 ? "+" : ""}{suggestion.pct}%)
                </p>
              );
            })()}
            {(() => {
              const cooldown = getCooldownInfo(c.id);
              if (!cooldown?.inCooldown) return null;
              const isExternal = cooldown.source !== "dashboard";
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p className={`text-[10px] font-medium mt-0.5 flex items-center justify-end gap-0.5 cursor-help ${isExternal ? "text-blue-500" : "text-amber-500"}`}>
                      <Clock className="h-2.5 w-2.5" />
                      Cooldown{cooldown.actor ? ` \u00b7 ${cooldown.actor}` : ""}
                    </p>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-[260px]">
                    {cooldown.label}
                  </TooltipContent>
                </Tooltip>
              );
            })()}
          </div>
        );
      },
    },
    {
      key: "roas",
      label: "ROAS",
      align: "right" as const,
      render: (val: unknown) => (
        <span className="font-medium">{Number(val || 0).toFixed(2)}x</span>
      ),
    },
    { key: "spend", label: "Investimento", format: "currency" as const, align: "right" as const },
    { key: "revenue", label: "Receita", format: "currency" as const, align: "right" as const },
    {
      key: "cps",
      label: "CPS",
      align: "right" as const,
      render: (_val: unknown, row: Record<string, unknown>) => {
        const c = row as unknown as CampaignWithMetrics;
        if (!c.purchases || c.purchases === 0) return <span className="text-muted-foreground">—</span>;
        return <span>{formatCurrency(c.spend / c.purchases)}</span>;
      },
    },
    { key: "impressions", label: "Impressoes", format: "number" as const, align: "right" as const },
    { key: "clicks", label: "Cliques", format: "number" as const, align: "right" as const },
    { key: "ctr", label: "CTR", format: "percent" as const, align: "right" as const },
    { key: "cpc", label: "CPC", format: "currency" as const, align: "right" as const },
  ];

  return (
    <TooltipProvider>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Campanhas</h1>
          <p className="text-sm text-muted-foreground">
            Performance e gestao de campanhas Meta Ads
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker value={datePreset} onChange={setDatePreset} />
          <Button asChild>
            <Link href="/campaigns/new">
              <Plus className="h-4 w-4 mr-2" />
              Nova Campanha
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Campanhas"
          value={formatNumber(totalCampaigns)}
          icon={Megaphone}
          iconColor="text-blue-400"
          loading={initialLoading}
        />
        <KpiCard
          title="Investimento"
          value={formatCurrency(totalSpend)}
          icon={DollarSign}
          iconColor="text-success"
          loading={initialLoading}
          badge="Meta"
          badgeColor="#818cf8"
        />
        <KpiCard
          title="ROAS Medio"
          value={`${avgRoas.toFixed(2)}x`}
          icon={Target}
          iconColor="text-purple-400"
          loading={initialLoading}
        />
        <KpiCard
          title="CTR Medio"
          value={formatPercent(avgCtr)}
          icon={MousePointerClick}
          iconColor="text-warning"
          loading={initialLoading}
        />
      </div>

      {/* Historico de Otimizacao */}
      <div className="border rounded-lg">
        <button
          onClick={() => setHistoryOpen(!historyOpen)}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          {historyOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <History className="h-4 w-4 text-muted-foreground" />
          Historico de Otimizacao
          {historyLogs.length > 0 && (
            <Badge variant="secondary" className="text-[10px] h-5 ml-1">
              {historyLogs.length}
            </Badge>
          )}
        </button>

        {historyOpen && (
          <div className="px-4 pb-4 space-y-4 border-t">
            {/* Period selector */}
            <div className="flex items-center gap-2 pt-3">
              {(["7d", "30d", "90d"] as const).map((p) => (
                <Button
                  key={p}
                  variant={historyPeriod === p ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setHistoryPeriod(p)}
                >
                  {p === "7d" ? "7 dias" : p === "30d" ? "30 dias" : "90 dias"}
                </Button>
              ))}
              {historyLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>

            {/* KPI mini-cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total ajustes</p>
                <p className="text-lg font-bold mt-1">
                  {historyScores?.total_changes ?? historyLogs.length}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <BrainCircuit className="h-3 w-3" /> Inteligentes
                </p>
                <p className="text-lg font-bold mt-1">
                  {(() => {
                    const total = historyScores?.total_changes ?? historyLogs.length;
                    const smart = historyScores?.smart_changes ?? historyLogs.filter((l) => l.was_smart).length;
                    return total > 0 ? `${Math.round((smart / total) * 100)}%` : "—";
                  })()}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Monitor className="h-3 w-3" /> Dashboard
                  <span className="mx-0.5">vs</span>
                  <Globe className="h-3 w-3" /> Meta
                </p>
                <p className="text-lg font-bold mt-1">
                  {historyScores
                    ? `${historyScores.dashboard_changes} / ${historyScores.external_changes}`
                    : `${historyLogs.filter((l) => l.source === "dashboard").length} / ${historyLogs.filter((l) => l.source === "external").length}`}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Oportunidades perdidas
                </p>
                <p className="text-lg font-bold mt-1 text-amber-500">
                  {historyScores?.missed_opportunities ?? "—"}
                </p>
              </div>
            </div>

            {/* Timeline */}
            {historyLogs.length === 0 && !historyLoading && (
              <p className="text-xs text-muted-foreground text-center py-4">
                Nenhum ajuste registrado neste periodo.
              </p>
            )}

            {historyLogs.length > 0 && (
              <div className="space-y-1 max-h-[320px] overflow-y-auto">
                {historyLogs.slice(0, 20).map((log, i) => {
                  const isIncrease = log.change_pct > 0;
                  return (
                    <div
                      key={`${log.campaign_id}-${log.created_at}-${i}`}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 text-sm"
                    >
                      {/* Source icon */}
                      <Tooltip>
                        <TooltipTrigger>
                          {log.source === "external" ? (
                            <Globe className="h-4 w-4 text-blue-500 shrink-0" />
                          ) : (
                            <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          {log.source === "external" ? "Alterado na Meta" : "Alterado pelo Dashboard"}
                        </TooltipContent>
                      </Tooltip>

                      {/* Campaign name */}
                      <span className="truncate max-w-[180px] text-xs">
                        {log.campaign_name || log.campaign_id}
                      </span>

                      {/* Budget change */}
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatBudget(String(log.old_budget))} → {formatBudget(String(log.new_budget))}
                      </span>

                      {/* Percentage */}
                      <span className={`text-xs font-medium whitespace-nowrap ${isIncrease ? "text-emerald-500" : "text-red-500"}`}>
                        {isIncrease ? "+" : ""}{typeof log.change_pct === "number" ? log.change_pct.toFixed(0) : log.change_pct}%
                      </span>

                      {/* Smart badge */}
                      {log.was_smart !== undefined && log.was_smart !== null && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] h-5 ${
                            log.was_smart
                              ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
                              : "text-red-500 border-red-500/30 bg-red-500/10"
                          }`}
                        >
                          {log.was_smart ? "Inteligente" : "Arriscado"}
                        </Badge>
                      )}

                      {/* User + Timestamp */}
                      <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap text-right">
                        {log.adjusted_by_email && (
                          <span className="block">{log.adjusted_by_email.split("@")[0]}</span>
                        )}
                        {timeAgo(log.created_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Historico de Alteracoes (Meta Activities) */}
      {accountId && accountId !== "all" && workspace?.id && (
        <ActivityHistory accountId={accountId} workspaceId={workspace.id} />
      )}

      {/* Loading Progress */}
      {loadingProgress && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Carregando... ({loadingProgress.loaded}/{loadingProgress.total} contas)</span>
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden max-w-[200px]">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${(loadingProgress.loaded / loadingProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Controls Row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Account Filter (multi-account only) */}
        {accountId === "all" && accounts.length > 1 && (
          <>
            <Select value={pageAccountFilter} onValueChange={setPageAccountFilter}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as Contas</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name || a.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="w-px h-6 bg-border mx-1" />
          </>
        )}

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | "ACTIVE" | "PAUSED")}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos Status</SelectItem>
            <SelectItem value="ACTIVE">Ativas</SelectItem>
            <SelectItem value="PAUSED">Pausadas</SelectItem>
          </SelectContent>
        </Select>

        <Input
          placeholder="Buscar campanhas..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-48 h-8 text-xs"
        />

        <div className="w-px h-6 bg-border mx-1" />

        <span className="text-xs text-muted-foreground">Ordenar por:</span>
        <Select value={sortKey} onValueChange={setSortKey}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="roas">ROAS</SelectItem>
            <SelectItem value="spend">Investimento</SelectItem>
            <SelectItem value="revenue">Receita</SelectItem>
            <SelectItem value="cps">CPS</SelectItem>
            <SelectItem value="daily_budget">Orcamento</SelectItem>
            <SelectItem value="ctr">CTR</SelectItem>
            <SelectItem value="impressions">Impressoes</SelectItem>
            <SelectItem value="clicks">Cliques</SelectItem>
            <SelectItem value="cpc">CPC</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
        </Button>

        <div className="w-px h-6 bg-border mx-1" />

        <span className="text-xs text-muted-foreground">Acao:</span>
        <div className="flex items-center gap-1 flex-wrap">
          <Button
            variant={tierFilter === "all" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => setTierFilter("all")}
          >
            Todos
          </Button>
          {(Object.keys(TIER_CONFIG) as Array<keyof typeof TIER_CONFIG>).map((key) => {
            const config = TIER_CONFIG[key];
            const Icon = config.icon;
            const count = tierCounts[key] || 0;
            return (
              <Button
                key={key}
                variant={tierFilter === key ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs px-2 gap-1"
                onClick={() => setTierFilter(key)}
              >
                <Icon className={`h-3 w-3 ${config.className.split(" ")[0]}`} />
                {config.label} {count > 0 && `(${count})`}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Tier description when filter is active */}
      {tierFilter !== "all" && tierFilter in TIER_CONFIG && (
        <p className="text-xs text-muted-foreground -mt-4">
          {TIER_CONFIG[tierFilter as keyof typeof TIER_CONFIG].description}
        </p>
      )}

      {/* Bulk Action Bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg -mt-2">
          <input
            type="checkbox"
            checked={selected.size === selectableCampaigns.length && selectableCampaigns.length > 0}
            ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < selectableCampaigns.length; }}
            onChange={toggleSelectAll}
            className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
          />
          <span className="text-sm font-medium">{selected.size} selecionada{selected.size !== 1 ? "s" : ""}</span>
          <div className="w-px h-5 bg-border" />
          <Button
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => {
              const targets = sorted.filter((c) => selected.has(c.id));
              openBudgetDialog(targets);
            }}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Ajustar Orcamento
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => setSelected(new Set())}
          >
            <X className="h-3.5 w-3.5" />
            Limpar
          </Button>
        </div>
      )}

      {/* Performance Table */}
      <PerformanceTable
        title={`${sorted.length} campanha${sorted.length !== 1 ? "s" : ""}`}
        selectedSet={selected}
        selectedKey="id"
        columns={columns}
        data={sorted as unknown as Array<Record<string, unknown>>}
        loading={initialLoading}
        actions={(row) => {
          const status = row.status as string;
          const id = row.id as string;
          return (
            <div className="flex items-center justify-end gap-1">
              <Link href={`/campaigns/${id}/edit`} onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </Link>
              {status === "ACTIVE" ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAction("pause", id);
                  }}
                  disabled={actionLoading === id}
                  title="Pausar"
                >
                  <Pause className="h-3.5 w-3.5" />
                </Button>
              ) : status === "PAUSED" ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAction("resume", id);
                  }}
                  disabled={actionLoading === id}
                  title="Retomar"
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAction("delete", id);
                }}
                disabled={actionLoading === id}
                title="Deletar"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        }}
      />

      {/* Empty state */}
      {!initialLoading && !loadingProgress && sorted.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Megaphone className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Nenhuma campanha encontrada
            </p>
          </CardContent>
        </Card>
      )}
      {/* Budget Adjust Dialog */}
      <Dialog open={budgetDialogOpen} onOpenChange={(open) => { if (!open) { setBudgetDialogOpen(false); setBudgetResults(null); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              {budgetDialogCampaigns.length === 1
                ? `Ajustar Orcamento — ${budgetDialogCampaigns[0]?.name}`
                : `Ajustar Orcamento em Massa (${budgetDialogCampaigns.length} campanhas)`}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-5">
            {/* Mode selector */}
            <div className="flex items-center gap-2">
              <Button
                variant={budgetMode === "percent" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => { setBudgetMode("percent"); setBudgetOverrides(new Map()); }}
              >
                Percentual
              </Button>
              <Button
                variant={budgetMode === "fixed" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => { setBudgetMode("fixed"); setBudgetOverrides(new Map()); }}
              >
                Valor Fixo
              </Button>
              <div className="flex-1" />
              {budgetDialogCampaigns.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={applyTierSuggestions}
                >
                  <Lightbulb className="h-3.5 w-3.5" />
                  Sugestao por tier
                </Button>
              )}
              {budgetDialogCampaigns.length === 1 && (() => {
                const s = getSuggestion(budgetDialogCampaigns[0]);
                if (s.pct === 0 && s.label === "Sem sugestao") return null;
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => {
                      if (s.pct === 0) return;
                      setBudgetMode("percent");
                      setBudgetPct(s.pct);
                      setBudgetOverrides(new Map());
                    }}
                  >
                    <Lightbulb className="h-3.5 w-3.5" />
                    {s.label} ({s.pct > 0 ? "+" : ""}{s.pct}%)
                  </Button>
                );
              })()}
            </div>

            {/* Percent slider */}
            {budgetMode === "percent" && budgetOverrides.size === 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Ajuste percentual</span>
                  <span className="text-sm font-medium">{budgetPct > 0 ? "+" : ""}{budgetPct}%</span>
                </div>
                <input
                  type="range"
                  min={-50}
                  max={100}
                  step={5}
                  value={budgetPct}
                  onChange={(e) => setBudgetPct(Number(e.target.value))}
                  className="w-full accent-primary cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>-50%</span>
                  <span>0%</span>
                  <span>+50%</span>
                  <span>+100%</span>
                </div>

                {/* Risk zone indicator */}
                {(() => {
                  const zone = getRiskZone(budgetPct);
                  const ZoneIcon = zone.icon;
                  return (
                    <div className={`flex items-center gap-1.5 text-xs ${zone.color}`}>
                      <ZoneIcon className="h-3.5 w-3.5" />
                      {zone.label}
                      {Math.abs(budgetPct) <= 20
                        ? " — nao reseta fase de aprendizado"
                        : Math.abs(budgetPct) <= 30
                        ? " — pode resetar fase de aprendizado"
                        : " — vai resetar fase de aprendizado"}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Fixed value input */}
            {budgetMode === "fixed" && budgetOverrides.size === 0 && (
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Novo orcamento diario (R$)</label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  placeholder="Ex: 50.00"
                  value={budgetFixedValue}
                  onChange={(e) => setBudgetFixedValue(e.target.value)}
                  className="w-48"
                />
              </div>
            )}

            {/* Per-tier override notice */}
            {budgetOverrides.size > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                <Lightbulb className="h-3.5 w-3.5 shrink-0" />
                <span>Sugestao individual por tier aplicada. Cada campanha recebeu um ajuste diferente.</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs ml-auto"
                  onClick={() => { setBudgetOverrides(new Map()); setBudgetPct(0); }}
                >
                  Resetar
                </Button>
              </div>
            )}

            {/* Cooldown warning */}
            {(() => {
              const inCooldown = budgetDialogCampaigns.filter((c) => getCooldownInfo(c.id)?.inCooldown);
              if (inCooldown.length === 0) return null;
              return (
                <div className="flex items-start gap-2 text-xs p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400">
                  <Clock className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">
                      {inCooldown.length === budgetDialogCampaigns.length
                        ? "Todas as campanhas estao em cooldown"
                        : `${inCooldown.length} campanha${inCooldown.length > 1 ? "s" : ""} em cooldown`}
                    </p>
                    <p className="mt-0.5 text-amber-600/80 dark:text-amber-400/80">
                      Ajustar novamente antes de 24h pode prejudicar a fase de aprendizado da Meta.
                      Voce pode continuar, mas recomendamos aguardar.
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Preview table */}
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Campanha</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">Tier</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Atual</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Novo</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Var.</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">Risco</th>
                  </tr>
                </thead>
                <tbody>
                  {budgetDialogCampaigns.map((c) => {
                    const current = parseBudgetCents(c);
                    const newB = getNewBudget(c);
                    const pct = getChangePct(c);
                    const zone = getRiskZone(pct);
                    const ZoneIcon = zone.icon;
                    const changed = current !== newB;
                    const cooldown = getCooldownInfo(c.id);

                    return (
                      <tr key={c.id} className={`border-b border-border/50 ${cooldown?.inCooldown ? "bg-amber-500/5" : ""}`}>
                        <td className="px-3 py-2 text-sm">
                          <div className="flex items-center gap-1.5">
                            <span>{c.name}</span>
                            {cooldown?.inCooldown && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Clock className="h-3 w-3 text-amber-500 shrink-0" />
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">{cooldown.label}</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center"><TierBadge tier={c.tier} /></td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{formatBudget(String(current))}/dia</td>
                        <td className={`px-3 py-2 text-right font-medium ${changed ? "" : "text-muted-foreground"}`}>
                          {formatBudget(String(newB))}/dia
                        </td>
                        <td className={`px-3 py-2 text-right ${pct > 0 ? "text-emerald-500" : pct < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                          {pct > 0 ? "+" : ""}{pct.toFixed(0)}%
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Tooltip>
                            <TooltipTrigger>
                              <ZoneIcon className={`h-4 w-4 mx-auto ${zone.color}`} />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">{zone.label}</TooltipContent>
                          </Tooltip>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Info tip */}
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              A Meta recomenda ajustes de no maximo 20% a cada 48-72h para preservar a fase de aprendizado.
              Alteracoes acima de 20% podem resetar o aprendizado e aumentar o CPA em 25-40%.
            </p>

            {/* Results */}
            {budgetResults && (
              <div className="space-y-1.5">
                {budgetResults.map((r, i) => (
                  <div key={i} className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded ${r.success ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}`}>
                    {r.success ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                    <span>
                      {r.success
                        ? `${budgetDialogCampaigns.find((c) => c.id === r.id)?.name || r.id} — atualizado`
                        : r.error || "Erro desconhecido"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setBudgetDialogOpen(false)} disabled={budgetSaving}>
              Cancelar
            </Button>
            <Button
              className="ml-auto gap-1.5"
              onClick={handleBudgetConfirm}
              disabled={budgetSaving || (budgetMode === "percent" && budgetPct === 0 && budgetOverrides.size === 0) || (budgetMode === "fixed" && !budgetFixedValue && budgetOverrides.size === 0)}
            >
              {budgetSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Confirmar Ajuste
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}
