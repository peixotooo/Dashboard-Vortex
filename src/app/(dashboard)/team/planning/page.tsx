"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Loader2,
  Trash2,
  Pencil,
  X,
  Link as LinkIcon,
  ImageIcon,
  CalendarDays,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

// --- Types ---

interface MarketingAction {
  id: string;
  title: string;
  description: string;
  category: string;
  color: string;
  start_date: string;
  end_date: string;
  status: string;
  content: { images?: string[]; links?: string[]; notes?: string };
  created_at: string;
  updated_at: string;
}

interface SpanSegment {
  actionId: string;
  title: string;
  color: string;
  weekRow: number;
  startCol: number;
  colSpan: number;
  isStart: boolean;
  isEnd: boolean;
  lane: number;
}

// --- Constants ---

const CATEGORIES: { value: string; label: string; color: string }[] = [
  { value: "campanha", label: "Campanha", color: "#EF4444" },
  { value: "conteudo", label: "Conteudo", color: "#8B5CF6" },
  { value: "social", label: "Social", color: "#EC4899" },
  { value: "email", label: "Email", color: "#F59E0B" },
  { value: "seo", label: "SEO", color: "#22C55E" },
  { value: "lancamento", label: "Lancamento", color: "#6366F1" },
  { value: "evento", label: "Evento", color: "#14B8A6" },
  { value: "geral", label: "Geral", color: "#3B82F6" },
];

const STATUS_OPTIONS = [
  { value: "planned", label: "Planejado" },
  { value: "in_progress", label: "Em andamento" },
  { value: "done", label: "Concluido" },
  { value: "cancelled", label: "Cancelado" },
];

const WEEKDAYS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// --- Helpers ---

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDateBR(s: string): string {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

function getMonthGrid(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - startOffset + i);
    days.push(d);
  }
  return days;
}

function segmentActions(
  actions: MarketingAction[],
  gridDays: Date[]
): SpanSegment[] {
  const segments: SpanSegment[] = [];

  for (const action of actions) {
    const aStart = parseDate(action.start_date);
    const aEnd = parseDate(action.end_date);

    for (let row = 0; row < 6; row++) {
      const weekStart = gridDays[row * 7];
      const weekEnd = gridDays[row * 7 + 6];

      if (aEnd < weekStart || aStart > weekEnd) continue;

      const startCol = aStart <= weekStart ? 0 : aStart.getDay();
      const endCol = aEnd >= weekEnd ? 6 : aEnd.getDay();
      const colSpan = endCol - startCol + 1;

      segments.push({
        actionId: action.id,
        title: action.title,
        color: action.color,
        weekRow: row,
        startCol,
        colSpan,
        isStart: aStart >= weekStart && aStart <= weekEnd,
        isEnd: aEnd >= weekStart && aEnd <= weekEnd,
        lane: 0,
      });
    }
  }

  // Assign lanes to avoid overlaps
  for (let row = 0; row < 6; row++) {
    const rowSegments = segments
      .filter((s) => s.weekRow === row)
      .sort((a, b) => a.startCol - b.startCol || b.colSpan - a.colSpan);

    const lanes: number[][] = [];

    for (const seg of rowSegments) {
      const segEnd = seg.startCol + seg.colSpan - 1;
      let placed = false;

      for (let l = 0; l < lanes.length; l++) {
        const occupied = lanes[l];
        const conflict = occupied.some(
          (col) => col >= seg.startCol && col <= segEnd
        );
        if (!conflict) {
          seg.lane = l;
          for (let c = seg.startCol; c <= segEnd; c++) occupied.push(c);
          placed = true;
          break;
        }
      }

      if (!placed) {
        seg.lane = lanes.length;
        const newLane: number[] = [];
        for (let c = seg.startCol; c <= segEnd; c++) newLane.push(c);
        lanes.push(newLane);
      }
    }
  }

  return segments;
}

// --- Main Component ---

export default function PlanningPage() {
  const { workspace } = useWorkspace();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [actions, setActions] = useState<MarketingAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAction, setEditingAction] = useState<MarketingAction | null>(null);
  const [detailAction, setDetailAction] = useState<MarketingAction | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");

  // Form state
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState("geral");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formStatus, setFormStatus] = useState("planned");
  const [formImages, setFormImages] = useState<string[]>([]);
  const [formLinks, setFormLinks] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [improving, setImproving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const headers = useMemo(
    () =>
      workspace
        ? { "x-workspace-id": workspace.id, "Content-Type": "application/json" }
        : undefined,
    [workspace]
  );

  const gridDays = useMemo(
    () => getMonthGrid(currentMonth.year, currentMonth.month),
    [currentMonth]
  );

  const today = useMemo(() => toDateStr(new Date()), []);

  // --- Fetch actions ---
  const fetchActions = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const start = toDateStr(gridDays[0]);
      const end = toDateStr(gridDays[41]);
      const res = await fetch(
        `/api/marketing/actions?start=${start}&end=${end}`,
        { headers }
      );
      if (res.ok) {
        const data = await res.json();
        setActions(data.actions || []);
      }
    } catch {
      // silent on load
    } finally {
      setLoading(false);
    }
  }, [workspace, gridDays, headers]);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  // --- Navigation ---
  const prevMonth = () =>
    setCurrentMonth((p) =>
      p.month === 0
        ? { year: p.year - 1, month: 11 }
        : { year: p.year, month: p.month - 1 }
    );

  const nextMonth = () =>
    setCurrentMonth((p) =>
      p.month === 11
        ? { year: p.year + 1, month: 0 }
        : { year: p.year, month: p.month + 1 }
    );

  const goToday = () => {
    const now = new Date();
    setCurrentMonth({ year: now.getFullYear(), month: now.getMonth() });
  };

  // --- Filter ---
  const filteredActions = useMemo(
    () =>
      filterCategory === "all"
        ? actions
        : actions.filter((a) => a.category === filterCategory),
    [actions, filterCategory]
  );

  const segments = useMemo(
    () => segmentActions(filteredActions, gridDays),
    [filteredActions, gridDays]
  );

  // --- Dialog helpers ---
  const resetForm = () => {
    setFormTitle("");
    setFormDescription("");
    setFormCategory("geral");
    setFormStartDate("");
    setFormEndDate("");
    setFormStatus("planned");
    setFormImages([]);
    setFormLinks([]);
    setEditingAction(null);
    setFormError(null);
  };

  const openCreateDialog = (date?: string) => {
    resetForm();
    if (date) {
      setFormStartDate(date);
      setFormEndDate(date);
    }
    setDialogOpen(true);
  };

  const openEditDialog = (action: MarketingAction) => {
    setEditingAction(action);
    setFormTitle(action.title);
    setFormDescription(action.description);
    setFormCategory(action.category);
    setFormStartDate(action.start_date);
    setFormEndDate(action.end_date);
    setFormStatus(action.status);
    setFormImages(action.content?.images || []);
    setFormLinks(action.content?.links || []);
    setFormError(null);
    setDetailAction(null);
    setDialogOpen(true);
  };

  // --- Save ---
  const handleSave = async () => {
    if (!formTitle || !formStartDate || !formEndDate || !headers) return;
    setFormError(null);
    setSaving(true);
    try {
      const body = {
        title: formTitle,
        description: formDescription,
        category: formCategory,
        start_date: formStartDate,
        end_date: formEndDate,
        status: formStatus,
        content: {
          images: formImages.filter(Boolean),
          links: formLinks.filter(Boolean),
        },
      };

      const res = editingAction
        ? await fetch(`/api/marketing/actions/${editingAction.id}`, {
            method: "PUT",
            headers,
            body: JSON.stringify(body),
          })
        : await fetch("/api/marketing/actions", {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFormError(data.error || "Erro ao salvar. Tente novamente.");
        return;
      }

      setDialogOpen(false);
      resetForm();
      fetchActions();
    } catch {
      setFormError("Erro de conexao. Verifique sua internet.");
    } finally {
      setSaving(false);
    }
  };

  // --- Delete ---
  const handleDelete = async (id: string) => {
    if (!headers) return;
    await fetch(`/api/marketing/actions/${id}`, {
      method: "DELETE",
      headers,
    });
    setDetailAction(null);
    fetchActions();
  };

  // --- Improve with AI ---
  const handleImprove = async () => {
    if (!formTitle || !headers) return;
    setFormError(null);
    setImproving(true);
    try {
      const res = await fetch("/api/marketing/improve-prompt", {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: formTitle,
          description: formDescription,
          category: formCategory,
          start_date: formStartDate || toDateStr(new Date()),
          end_date: formEndDate || toDateStr(new Date()),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.improved_text) {
          setFormDescription(data.improved_text);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        setFormError(data.error || "Erro ao melhorar texto com IA.");
      }
    } catch {
      setFormError("Erro de conexao ao chamar IA.");
    } finally {
      setImproving(false);
    }
  };

  // --- Compute segments per cell for unified grid ---
  const cellSegments = useMemo(() => {
    const map: Record<string, SpanSegment[]> = {};
    for (const seg of segments) {
      const key = `${seg.weekRow}-${seg.startCol}`;
      if (!map[key]) map[key] = [];
      map[key].push(seg);
    }
    return map;
  }, [segments]);

  // --- Render ---
  if (!workspace) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Planejamento</h1>
        </div>
        <Button onClick={() => openCreateDialog()} size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Nova Acao
        </Button>
      </div>

      {/* Month nav + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={prevMonth} className="h-8 w-8">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <button
            onClick={goToday}
            className="min-w-[200px] text-center text-lg font-bold tracking-tight hover:text-primary transition-colors cursor-pointer"
          >
            {MONTH_NAMES[currentMonth.month]} {currentMonth.year}
          </button>
          <Button variant="ghost" size="icon" onClick={nextMonth} className="h-8 w-8">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant={filterCategory === "all" ? "default" : "outline"}
            className="cursor-pointer text-xs"
            onClick={() => setFilterCategory("all")}
          >
            Todos
          </Badge>
          {CATEGORIES.map((cat) => (
            <Badge
              key={cat.value}
              variant={filterCategory === cat.value ? "default" : "outline"}
              className="cursor-pointer text-xs"
              style={
                filterCategory === cat.value
                  ? { backgroundColor: cat.color, borderColor: cat.color, color: "#fff" }
                  : { borderColor: cat.color + "60", color: cat.color }
              }
              onClick={() =>
                setFilterCategory(
                  filterCategory === cat.value ? "all" : cat.value
                )
              }
            >
              {cat.label}
            </Badge>
          ))}
        </div>
      </div>

      {/* Calendar */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 bg-muted/60">
          {WEEKDAYS.map((d, i) => (
            <div
              key={d}
              className={`py-2.5 text-center text-[11px] font-semibold tracking-widest text-muted-foreground ${
                i < 6 ? "border-r border-border/50" : ""
              }`}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex h-[500px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {gridDays.map((day, idx) => {
              const dateStr = toDateStr(day);
              const isCurrentMonth = day.getMonth() === currentMonth.month;
              const isToday = dateStr === today;
              const rowIdx = Math.floor(idx / 7);
              const colIdx = idx % 7;

              // Get segments that START in this cell
              const segsHere = segments.filter(
                (s) => s.weekRow === rowIdx && s.startCol === colIdx
              );

              return (
                <div
                  key={idx}
                  className={`group relative min-h-[100px] border-b border-r border-border/40 p-1.5 transition-colors cursor-pointer ${
                    isCurrentMonth
                      ? "bg-card hover:bg-accent/20"
                      : "bg-muted/20 hover:bg-muted/40"
                  } ${colIdx === 6 ? "border-r-0" : ""} ${
                    idx >= 35 ? "border-b-0" : ""
                  }`}
                  onClick={() => openCreateDialog(dateStr)}
                >
                  {/* Day number */}
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                        isToday
                          ? "bg-primary text-primary-foreground font-bold"
                          : isCurrentMonth
                          ? "text-foreground"
                          : "text-muted-foreground/50"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    <Plus className="h-4 w-4 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>

                  {/* Action spans that start in this cell */}
                  <div className="space-y-0.5">
                    {segsHere.map((seg, i) => (
                      <div
                        key={`${seg.actionId}-${i}`}
                        className="relative z-10 truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-tight cursor-pointer transition-all hover:brightness-90 hover:shadow-sm"
                        style={{
                          backgroundColor: seg.color,
                          color: "#fff",
                          width:
                            seg.colSpan > 1
                              ? `calc(${seg.colSpan * 100}% + ${(seg.colSpan - 1) * 1}px)`
                              : "100%",
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const action = actions.find(
                            (a) => a.id === seg.actionId
                          );
                          if (action) setDetailAction(action);
                        }}
                      >
                        {seg.title}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground px-1">
        {CATEGORIES.map((cat) => (
          <span key={cat.value} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-5 rounded-sm"
              style={{ backgroundColor: cat.color }}
            />
            {cat.label}
          </span>
        ))}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingAction ? "Editar Acao" : "Nova Acao"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Error */}
            {formError && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Title */}
            <div className="space-y-1.5">
              <Label>Titulo</Label>
              <Input
                placeholder="Ex: Campanha de Dia das Maes"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
              />
            </div>

            {/* Category + Status */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: cat.color }}
                          />
                          {cat.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={formStatus} onValueChange={setFormStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Inicio</Label>
                <Input
                  type="date"
                  value={formStartDate}
                  onChange={(e) => setFormStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Fim</Label>
                <Input
                  type="date"
                  value={formEndDate}
                  onChange={(e) => setFormEndDate(e.target.value)}
                />
              </div>
            </div>

            {/* Description + AI improve */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Descricao</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={handleImprove}
                  disabled={improving || !formTitle}
                >
                  {improving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {improving ? "Melhorando..." : "Melhorar com IA"}
                </Button>
              </div>
              <Textarea
                placeholder="Descreva a acao, objetivo, canais, publico..."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                className="min-h-[120px]"
              />
            </div>

            {/* Images */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5">
                  <ImageIcon className="h-3.5 w-3.5" />
                  Imagens (URLs)
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setFormImages([...formImages, ""])}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              {formImages.map((img, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder="https://..."
                    value={img}
                    onChange={(e) => {
                      const copy = [...formImages];
                      copy[i] = e.target.value;
                      setFormImages(copy);
                    }}
                    className="text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() =>
                      setFormImages(formImages.filter((_, j) => j !== i))
                    }
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Links */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5">
                  <LinkIcon className="h-3.5 w-3.5" />
                  Links
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setFormLinks([...formLinks, ""])}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              {formLinks.map((link, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder="https://..."
                    value={link}
                    onChange={(e) => {
                      const copy = [...formLinks];
                      copy[i] = e.target.value;
                      setFormLinks(copy);
                    }}
                    className="text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() =>
                      setFormLinks(formLinks.filter((_, j) => j !== i))
                    }
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setDialogOpen(false);
                  resetForm();
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !formTitle || !formStartDate || !formEndDate}
              >
                {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {editingAction ? "Salvar" : "Criar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Action Detail Sheet */}
      <Sheet
        open={!!detailAction}
        onOpenChange={(open) => {
          if (!open) setDetailAction(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          {detailAction && (
            <>
              <SheetHeader>
                <SheetTitle className="text-left">
                  {detailAction.title}
                </SheetTitle>
              </SheetHeader>

              <div className="mt-4 space-y-4">
                {/* Badges */}
                <div className="flex flex-wrap gap-2">
                  <Badge
                    style={{
                      backgroundColor: detailAction.color,
                      color: "#fff",
                    }}
                  >
                    {CATEGORIES.find((c) => c.value === detailAction.category)
                      ?.label || detailAction.category}
                  </Badge>
                  <Badge variant="secondary">
                    {STATUS_OPTIONS.find(
                      (s) => s.value === detailAction.status
                    )?.label || detailAction.status}
                  </Badge>
                </div>

                {/* Dates */}
                <div className="text-sm text-muted-foreground">
                  <CalendarDays className="mr-1.5 inline h-4 w-4" />
                  {formatDateBR(detailAction.start_date)} —{" "}
                  {formatDateBR(detailAction.end_date)}
                </div>

                {/* Description */}
                {detailAction.description && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      Descricao
                    </p>
                    <p className="whitespace-pre-wrap text-sm">
                      {detailAction.description}
                    </p>
                  </div>
                )}

                {/* Images */}
                {detailAction.content?.images &&
                  detailAction.content.images.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Imagens
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {detailAction.content.images.map((url, i) => (
                          <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`Imagem ${i + 1}`}
                              className="rounded-md border border-border object-cover w-full h-32"
                            />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Links */}
                {detailAction.content?.links &&
                  detailAction.content.links.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        Links
                      </p>
                      {detailAction.content.links.map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                        >
                          <LinkIcon className="h-3 w-3" />
                          {url}
                        </a>
                      ))}
                    </div>
                  )}

                {/* Actions */}
                <div className="flex gap-2 pt-4 border-t border-border">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditDialog(detailAction)}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Editar
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(detailAction.id)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Excluir
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
