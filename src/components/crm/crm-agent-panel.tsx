"use client";

import React, { useState, useEffect, useRef } from "react";
import { Send, Loader2, Filter, Bot, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import type {
  RfmSegment,
  DayRange,
  LifecycleStage,
  HourPref,
  CouponSensitivity,
  Weekday,
} from "@/lib/crm-rfm";

// --- Types ---

export interface CrmFilters {
  segmentFilter: RfmSegment | "all";
  dayRangeFilter: DayRange | "all";
  lifecycleFilter: LifecycleStage | "all";
  hourFilter: HourPref | "all";
  couponFilter: CouponSensitivity | "all";
  weekdayFilter: Weekday | "all";
}

interface Suggestion {
  name: string;
  description: string;
  reasoning: string;
  filters: {
    segmentFilter?: string;
    lifecycleFilter?: string;
    couponFilter?: string;
    hourFilter?: string;
    weekdayFilter?: string;
    dayRangeFilter?: string;
  };
  estimatedCount: number;
  urgency: "alta" | "media" | "baixa";
}

interface SuggestionsResponse {
  suggestions: Suggestion[];
  analysis?: string;
  excludedCount?: number;
  cooldownDays?: number;
  error?: string;
}

interface CrmAgentPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplyFilters: (filters: CrmFilters) => void;
  cooldownDays: number;
}

// --- Main Component ---

export function CrmAgentPanel({
  open,
  onOpenChange,
  onApplyFilters,
  cooldownDays,
}: CrmAgentPanelProps) {
  const { workspace } = useWorkspace();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [appliedIndex, setAppliedIndex] = useState<number | null>(null);
  const [excludedCount, setExcludedCount] = useState(0);
  const hasFetched = useRef(false);

  // Auto-fetch on first open
  useEffect(() => {
    if (open && !hasFetched.current && workspace?.id) {
      hasFetched.current = true;
      fetchSuggestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspace?.id]);

  async function fetchSuggestions(q?: string) {
    setLoading(true);
    setError("");
    setAppliedIndex(null);
    try {
      const res = await fetch("/api/crm/suggestions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspace?.id || "",
        },
        body: JSON.stringify({
          ...(q ? { question: q } : {}),
          cooldownDays,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Erro ${res.status}`);
      }

      const data: SuggestionsResponse = await res.json();
      setSuggestions(data.suggestions || []);
      setAnalysis(data.analysis || "");
      setExcludedCount(data.excludedCount || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao buscar sugestoes");
    } finally {
      setLoading(false);
    }
  }

  function handleApplyFilters(suggestion: Suggestion, index: number) {
    setAppliedIndex(index);
    onApplyFilters({
      segmentFilter: (suggestion.filters.segmentFilter as RfmSegment) || "all",
      dayRangeFilter: (suggestion.filters.dayRangeFilter as DayRange) || "all",
      lifecycleFilter:
        (suggestion.filters.lifecycleFilter as LifecycleStage) || "all",
      hourFilter: (suggestion.filters.hourFilter as HourPref) || "all",
      couponFilter:
        (suggestion.filters.couponFilter as CouponSensitivity) || "all",
      weekdayFilter: (suggestion.filters.weekdayFilter as Weekday) || "all",
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || loading) return;
    const q = question.trim();
    setQuestion("");
    fetchSuggestions(q);
  }

  const urgencyColors = {
    alta: "border-red-500/30 bg-red-500/5",
    media: "border-yellow-500/30 bg-yellow-500/5",
    baixa: "border-green-500/30 bg-green-500/5",
  };
  const urgencyBadge = {
    alta: "text-red-400 bg-red-500/10 border-red-500/30",
    media: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
    baixa: "text-green-400 bg-green-500/10 border-green-500/30",
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="sm:max-w-xl w-full p-0 flex flex-col"
      >
        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-sky-500 flex items-center justify-center text-white shrink-0">
              <Bot className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <SheetTitle className="text-base">
                Ana — CRM Intelligence
              </SheetTitle>
              <SheetDescription className="text-xs">
                Hipersegmentacoes com alta chance de conversao
              </SheetDescription>
            </div>
          </div>
          {excludedCount > 0 && !loading && (
            <div className="flex items-center gap-1.5 mt-2">
              <span className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
                {excludedCount} clientes excluidos (nao perturbe {cooldownDays}d)
              </span>
            </div>
          )}
        </SheetHeader>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
              <p className="text-sm text-muted-foreground">
                Analisando seus dados de CRM...
              </p>
              <p className="text-xs text-muted-foreground/60">
                Cruzando segmentos, comportamento e exportacoes
              </p>
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400">
              {error}
              <Button
                variant="outline"
                size="sm"
                className="mt-2 text-xs"
                onClick={() => fetchSuggestions()}
              >
                Tentar novamente
              </Button>
            </div>
          )}

          {/* Analysis */}
          {analysis && !loading && (
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-sm text-foreground/80 leading-relaxed">
                {analysis}
              </p>
            </div>
          )}

          {/* Suggestions */}
          {suggestions.length > 0 &&
            !loading &&
            suggestions.map((s, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-lg border p-4 transition-all",
                  urgencyColors[s.urgency] || urgencyColors.media,
                  appliedIndex === i && "ring-2 ring-sky-500/50"
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h4 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                    {s.name}
                  </h4>
                  <span
                    className={cn(
                      "text-[10px] font-bold uppercase px-2 py-0.5 rounded border shrink-0",
                      urgencyBadge[s.urgency] || urgencyBadge.media
                    )}
                  >
                    {s.urgency}
                  </span>
                </div>

                <p className="text-xs text-muted-foreground mb-2">
                  {s.description}
                </p>
                <p className="text-xs text-foreground/70 mb-3 leading-relaxed">
                  {s.reasoning}
                </p>

                {/* Metadata */}
                <div className="flex flex-wrap gap-1.5 text-[11px] mb-3">
                  <span className="bg-card border border-border px-2 py-0.5 rounded">
                    ~{s.estimatedCount} clientes
                  </span>
                  {Object.entries(s.filters)
                    .filter(([, v]) => v && v !== "all")
                    .map(([k, v]) => (
                      <span
                        key={k}
                        className="bg-card border border-border px-2 py-0.5 rounded"
                      >
                        {v}
                      </span>
                    ))}
                </div>

                {/* Apply button */}
                <Button
                  size="sm"
                  variant={appliedIndex === i ? "default" : "outline"}
                  className="text-xs gap-1 h-7"
                  onClick={() => handleApplyFilters(s, i)}
                >
                  <Filter className="h-3 w-3" />
                  {appliedIndex === i ? "Filtros Aplicados" : "Aplicar Filtros"}
                </Button>
              </div>
            ))}

          {/* Empty state */}
          {!loading && !error && suggestions.length === 0 && !analysis && (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3 opacity-60">
              <Bot className="h-10 w-10 text-sky-500" />
              <p className="text-sm text-muted-foreground max-w-xs">
                Analisando dados de CRM para sugerir segmentacoes inteligentes.
              </p>
            </div>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="shrink-0 border-t border-border p-3 flex gap-2"
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Pergunte sobre segmentacoes..."
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 h-10"
            disabled={loading}
          />
          <Button
            type="submit"
            size="icon"
            disabled={loading || !question.trim()}
            className="h-10 w-10 shrink-0"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
