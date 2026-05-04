"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  CalendarDays,
  AlertCircle,
  Hash,
  Megaphone,
  Eye,
  Upload,
  FileText,
  Film,
  ImageIcon,
  Download,
  Maximize2,
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading2,
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
import { MessageContent } from "@/components/ui/message-content";

// --- Types ---

type PlanningType = "social" | "performance";

interface MediaItem {
  url: string;
  type: "image" | "video" | "pdf" | "file";
  filename?: string;
  size?: number;
  storage_key?: string;
}

interface MarketingAction {
  id: string;
  title: string;
  description: string;
  category: string;
  planning_type: PlanningType;
  color: string;
  start_date: string;
  end_date: string;
  status: string;
  content: {
    images?: string[];
    links?: string[];
    notes?: string;
    media?: MediaItem[];
  };
  created_at: string;
  updated_at: string;
}

interface SpanSegment {
  actionId: string;
  title: string;
  color: string;
  planningType: PlanningType;
  weekRow: number;
  startCol: number;
  colSpan: number;
  isStart: boolean;
  isEnd: boolean;
  lane: number;
}

interface UploadingFile {
  id: string;
  filename: string;
  progress: "uploading" | "done" | "error";
  error?: string;
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

const PLANNING_TYPES: {
  value: PlanningType;
  label: string;
  shortLabel: string;
  icon: typeof Hash;
}[] = [
  { value: "social", label: "Social Media", shortLabel: "Social", icon: Hash },
  {
    value: "performance",
    label: "Performance",
    shortLabel: "Performance",
    icon: Megaphone,
  },
];

const WEEKDAYS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const ACCEPTED_MIME = [
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "video/mp4", "video/quicktime", "video/x-msvideo", "video/webm",
  "application/pdf",
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

function detectMediaType(mime: string): MediaItem["type"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return "file";
}

function detectMediaTypeFromUrl(url: string): MediaItem["type"] {
  const lower = url.toLowerCase().split("?")[0];
  if (/\.(jpe?g|png|gif|webp|avif)$/i.test(lower)) return "image";
  if (/\.(mp4|mov|avi|webm)$/i.test(lower)) return "video";
  if (/\.pdf$/i.test(lower)) return "pdf";
  return "file";
}

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeMedia(content: MarketingAction["content"]): MediaItem[] {
  if (content?.media && content.media.length > 0) return content.media;
  // Backwards compat: legacy content.images: string[]
  if (content?.images && content.images.length > 0) {
    return content.images
      .filter((u): u is string => Boolean(u))
      .map((url) => ({
        url,
        type: detectMediaTypeFromUrl(url),
      }));
  }
  return [];
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
        planningType: action.planning_type || "social",
        weekRow: row,
        startCol,
        colSpan,
        isStart: aStart >= weekStart && aStart <= weekEnd,
        isEnd: aEnd >= weekStart && aEnd <= weekEnd,
        lane: 0,
      });
    }
  }

  // Assign lanes to avoid overlaps (sort by type then by start so social goes first)
  for (let row = 0; row < 6; row++) {
    const rowSegments = segments
      .filter((s) => s.weekRow === row)
      .sort(
        (a, b) =>
          (a.planningType === b.planningType
            ? 0
            : a.planningType === "social"
            ? -1
            : 1) ||
          a.startCol - b.startCol ||
          b.colSpan - a.colSpan
      );

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

// Insert markdown around the textarea selection
function applyMarkdown(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  placeholder: string,
  setValue: (v: string) => void
) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end) || placeholder;
  const next = value.slice(0, start) + before + selected + after + value.slice(end);
  setValue(next);
  requestAnimationFrame(() => {
    textarea.focus();
    const cursorStart = start + before.length;
    textarea.setSelectionRange(cursorStart, cursorStart + selected.length);
  });
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
  const [filterType, setFilterType] = useState<"all" | PlanningType>("all");

  // Form state
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState("geral");
  const [formPlanningType, setFormPlanningType] = useState<PlanningType>("social");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formStatus, setFormStatus] = useState("planned");
  const [formMedia, setFormMedia] = useState<MediaItem[]>([]);
  const [formLinks, setFormLinks] = useState<string[]>([]);
  const [uploads, setUploads] = useState<UploadingFile[]>([]);
  const [descTab, setDescTab] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const [improving, setImproving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{
    items: MediaItem[];
    index: number;
  } | null>(null);

  const descRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        const list: MarketingAction[] = (data.actions || []).map(
          (a: MarketingAction) => ({
            ...a,
            planning_type: a.planning_type || "social",
          })
        );
        setActions(list);
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
  const filteredActions = useMemo(() => {
    let list = actions;
    if (filterCategory !== "all") {
      list = list.filter((a) => a.category === filterCategory);
    }
    if (filterType !== "all") {
      list = list.filter((a) => (a.planning_type || "social") === filterType);
    }
    return list;
  }, [actions, filterCategory, filterType]);

  const segments = useMemo(
    () => segmentActions(filteredActions, gridDays),
    [filteredActions, gridDays]
  );

  // Counts for header badges
  const typeCounts = useMemo(() => {
    const social = actions.filter(
      (a) => (a.planning_type || "social") === "social"
    ).length;
    const performance = actions.filter(
      (a) => a.planning_type === "performance"
    ).length;
    return { social, performance };
  }, [actions]);

  // --- Dialog helpers ---
  const resetForm = () => {
    setFormTitle("");
    setFormDescription("");
    setFormCategory("geral");
    setFormPlanningType("social");
    setFormStartDate("");
    setFormEndDate("");
    setFormStatus("planned");
    setFormMedia([]);
    setFormLinks([]);
    setUploads([]);
    setDescTab("edit");
    setEditingAction(null);
    setFormError(null);
  };

  const openCreateDialog = (date?: string, planningType?: PlanningType) => {
    resetForm();
    if (date) {
      setFormStartDate(date);
      setFormEndDate(date);
    }
    if (planningType) setFormPlanningType(planningType);
    else if (filterType !== "all") setFormPlanningType(filterType);
    setDialogOpen(true);
  };

  const openEditDialog = (action: MarketingAction) => {
    setEditingAction(action);
    setFormTitle(action.title);
    setFormDescription(action.description);
    setFormCategory(action.category);
    setFormPlanningType(action.planning_type || "social");
    setFormStartDate(action.start_date);
    setFormEndDate(action.end_date);
    setFormStatus(action.status);
    setFormMedia(normalizeMedia(action.content));
    setFormLinks(action.content?.links || []);
    setUploads([]);
    setDescTab("edit");
    setFormError(null);
    setDetailAction(null);
    setDialogOpen(true);
  };

  // --- Upload ---
  const handleUploadFiles = async (files: FileList | File[]) => {
    if (!workspace) return;
    const list = Array.from(files);

    for (const file of list) {
      if (!ACCEPTED_MIME.includes(file.type)) {
        setFormError(`Tipo nao suportado: ${file.name}`);
        continue;
      }

      const tmpId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setUploads((prev) => [
        ...prev,
        { id: tmpId, filename: file.name, progress: "uploading" },
      ]);

      try {
        const wsHeaders: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (workspace?.id) wsHeaders["x-workspace-id"] = workspace.id;

        const urlRes = await fetch("/api/media/upload-url", {
          method: "POST",
          headers: wsHeaders,
          body: JSON.stringify({
            filename: file.name,
            mime_type: file.type,
          }),
        });
        const urlData = await urlRes.json();
        if (!urlRes.ok) {
          throw new Error(urlData.error || "Falha ao obter URL de upload");
        }

        const putRes = await fetch(urlData.signedUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!putRes.ok) {
          throw new Error(`Erro ao subir para storage (${putRes.status})`);
        }

        setFormMedia((prev) => [
          ...prev,
          {
            url: urlData.publicUrl,
            type: detectMediaType(file.type),
            filename: file.name,
            size: file.size,
            storage_key: urlData.key,
          },
        ]);
        setUploads((prev) =>
          prev.map((u) =>
            u.id === tmpId ? { ...u, progress: "done" } : u
          )
        );
        // Auto-clean done entries
        setTimeout(() => {
          setUploads((prev) => prev.filter((u) => u.id !== tmpId));
        }, 1500);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro no upload";
        setUploads((prev) =>
          prev.map((u) =>
            u.id === tmpId ? { ...u, progress: "error", error: msg } : u
          )
        );
        setFormError(msg);
      }
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUploadFiles(e.target.files);
      e.target.value = "";
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUploadFiles(e.dataTransfer.files);
    }
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
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
        planning_type: formPlanningType,
        start_date: formStartDate,
        end_date: formEndDate,
        status: formStatus,
        content: {
          media: formMedia,
          // Legacy field for any downstream readers (sync, etc.)
          images: formMedia.filter((m) => m.type === "image").map((m) => m.url),
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
      {/* Striped pattern for performance chips */}
      <style jsx global>{`
        .perf-stripe {
          background-image: repeating-linear-gradient(
            -45deg,
            rgba(255, 255, 255, 0) 0,
            rgba(255, 255, 255, 0) 6px,
            rgba(255, 255, 255, 0.18) 6px,
            rgba(255, 255, 255, 0.18) 9px
          );
        }
      `}</style>

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

      {/* Type segmented control */}
      <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-1">
        <button
          onClick={() => setFilterType("all")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            filterType === "all"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Tudo
          <span className="text-[10px] text-muted-foreground/70">
            {actions.length}
          </span>
        </button>
        <button
          onClick={() => setFilterType("social")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            filterType === "social"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Hash className="h-3 w-3" />
          Social Media
          <span className="text-[10px] text-muted-foreground/70">
            {typeCounts.social}
          </span>
        </button>
        <button
          onClick={() => setFilterType("performance")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            filterType === "performance"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Megaphone className="h-3 w-3" />
          Performance
          <span className="text-[10px] text-muted-foreground/70">
            {typeCounts.performance}
          </span>
        </button>
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

              // Get segments that START in this cell, separated by type
              const segsHere = segments.filter(
                (s) => s.weekRow === rowIdx && s.startCol === colIdx
              );
              const socialSegs = segsHere.filter(
                (s) => s.planningType === "social"
              );
              const perfSegs = segsHere.filter(
                (s) => s.planningType === "performance"
              );
              const showDivider = socialSegs.length > 0 && perfSegs.length > 0;

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
                    {socialSegs.map((seg, i) => (
                      <ActionChip
                        key={`s-${seg.actionId}-${i}`}
                        seg={seg}
                        actions={actions}
                        onSelect={setDetailAction}
                      />
                    ))}
                    {showDivider && (
                      <div className="my-1 flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-muted-foreground/60">
                        <span className="h-px flex-1 bg-border/60" />
                        <Megaphone className="h-2.5 w-2.5" />
                        <span className="h-px flex-1 bg-border/60" />
                      </div>
                    )}
                    {perfSegs.map((seg, i) => (
                      <ActionChip
                        key={`p-${seg.actionId}-${i}`}
                        seg={seg}
                        actions={actions}
                        onSelect={setDetailAction}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground px-1">
        <span className="flex items-center gap-1.5">
          <Hash className="h-3 w-3" />
          Social Media
        </span>
        <span className="flex items-center gap-1.5">
          <Megaphone className="h-3 w-3" />
          <span className="inline-block h-2.5 w-5 rounded-sm bg-muted-foreground/40 perf-stripe" />
          Performance
        </span>
        <span className="mx-2 h-3 w-px bg-border" />
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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

            {/* Planning type toggle */}
            <div className="space-y-1.5">
              <Label>Tipo de planejamento</Label>
              <div className="grid grid-cols-2 gap-2">
                {PLANNING_TYPES.map((pt) => {
                  const Icon = pt.icon;
                  const active = formPlanningType === pt.value;
                  return (
                    <button
                      key={pt.value}
                      type="button"
                      onClick={() => setFormPlanningType(pt.value)}
                      className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:bg-muted/40"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {pt.label}
                    </button>
                  );
                })}
              </div>
            </div>

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

            {/* Description with markdown editor + preview */}
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

              <div className="rounded-lg border border-border overflow-hidden">
                {/* Toolbar */}
                <div className="flex items-center justify-between border-b border-border bg-muted/30 px-2 py-1">
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      title="Negrito"
                      className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        if (descRef.current)
                          applyMarkdown(
                            descRef.current,
                            "**",
                            "**",
                            "negrito",
                            setFormDescription
                          );
                      }}
                    >
                      <Bold className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Italico"
                      className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        if (descRef.current)
                          applyMarkdown(
                            descRef.current,
                            "*",
                            "*",
                            "italico",
                            setFormDescription
                          );
                      }}
                    >
                      <Italic className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Titulo"
                      className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        if (descRef.current)
                          applyMarkdown(
                            descRef.current,
                            "## ",
                            "",
                            "Titulo",
                            setFormDescription
                          );
                      }}
                    >
                      <Heading2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Lista"
                      className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        if (descRef.current)
                          applyMarkdown(
                            descRef.current,
                            "- ",
                            "",
                            "item",
                            setFormDescription
                          );
                      }}
                    >
                      <List className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Lista numerada"
                      className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        if (descRef.current)
                          applyMarkdown(
                            descRef.current,
                            "1. ",
                            "",
                            "item",
                            setFormDescription
                          );
                      }}
                    >
                      <ListOrdered className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Link"
                      className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        if (descRef.current)
                          applyMarkdown(
                            descRef.current,
                            "[",
                            "](https://)",
                            "texto",
                            setFormDescription
                          );
                      }}
                    >
                      <LinkIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setDescTab("edit")}
                      className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                        descTab === "edit"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Pencil className="h-3 w-3" />
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => setDescTab("preview")}
                      className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                        descTab === "preview"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Eye className="h-3 w-3" />
                      Preview
                    </button>
                  </div>
                </div>

                {descTab === "edit" ? (
                  <Textarea
                    ref={descRef}
                    placeholder="Descreva a acao com markdown: **negrito**, *italico*, # titulos, - listas, [links](https://)..."
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    className="min-h-[160px] border-0 rounded-none font-mono text-xs focus-visible:ring-0"
                  />
                ) : (
                  <div className="min-h-[160px] p-3">
                    {formDescription ? (
                      <MessageContent content={formDescription} />
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        Nada para mostrar.
                      </p>
                    )}
                  </div>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Suporta markdown: **negrito**, *italico*, # titulos, - listas,
                [links](url), tabelas.
              </p>
            </div>

            {/* Media uploads */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5">
                  <ImageIcon className="h-3.5 w-3.5" />
                  Midias
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3 w-3" />
                  Enviar arquivos
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_MIME.join(",")}
                  className="hidden"
                  onChange={onFileInputChange}
                />
              </div>

              <div
                onDrop={onDrop}
                onDragOver={onDragOver}
                className="rounded-lg border-2 border-dashed border-border bg-muted/20 p-3 transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                {formMedia.length === 0 && uploads.length === 0 ? (
                  <div
                    className="flex flex-col items-center justify-center py-6 text-center cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-6 w-6 text-muted-foreground/60 mb-2" />
                    <p className="text-xs font-medium text-muted-foreground">
                      Arraste arquivos aqui ou clique para enviar
                    </p>
                    <p className="text-[10px] text-muted-foreground/70 mt-1">
                      Imagens, videos ou PDF (hospedado em Backblaze)
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {formMedia.map((m, i) => (
                      <MediaPreviewCard
                        key={`${m.url}-${i}`}
                        media={m}
                        onRemove={() =>
                          setFormMedia(formMedia.filter((_, j) => j !== i))
                        }
                        onExpand={() =>
                          setLightbox({ items: formMedia, index: i })
                        }
                      />
                    ))}
                    {uploads.map((u) => (
                      <div
                        key={u.id}
                        className="relative aspect-square rounded-md border border-border bg-background flex flex-col items-center justify-center gap-1.5 p-2"
                      >
                        {u.progress === "uploading" ? (
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        ) : u.progress === "error" ? (
                          <AlertCircle className="h-5 w-5 text-destructive" />
                        ) : (
                          <div className="h-5 w-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                            <div className="h-2 w-2 rounded-full bg-emerald-500" />
                          </div>
                        )}
                        <p className="text-[9px] text-muted-foreground truncate w-full text-center">
                          {u.filename}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
                disabled={
                  saving ||
                  !formTitle ||
                  !formStartDate ||
                  !formEndDate ||
                  uploads.some((u) => u.progress === "uploading")
                }
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
        <SheetContent className="overflow-y-auto sm:max-w-lg">
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
                    variant="outline"
                    className="gap-1"
                  >
                    {(detailAction.planning_type || "social") === "performance" ? (
                      <>
                        <Megaphone className="h-3 w-3" />
                        Performance
                      </>
                    ) : (
                      <>
                        <Hash className="h-3 w-3" />
                        Social Media
                      </>
                    )}
                  </Badge>
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

                {/* Description (markdown) */}
                {detailAction.description && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      Descricao
                    </p>
                    <div className="rounded-lg border border-border bg-muted/20 p-3">
                      <MessageContent content={detailAction.description} />
                    </div>
                  </div>
                )}

                {/* Media */}
                {(() => {
                  const media = normalizeMedia(detailAction.content);
                  if (media.length === 0) return null;
                  return (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Midias ({media.length})
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {media.map((m, i) => (
                          <MediaPreviewCard
                            key={i}
                            media={m}
                            onExpand={() =>
                              setLightbox({ items: media, index: i })
                            }
                          />
                        ))}
                      </div>
                    </div>
                  );
                })()}

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
                          className="flex items-center gap-1.5 text-sm text-primary hover:underline break-all"
                        >
                          <LinkIcon className="h-3 w-3 shrink-0" />
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

      {/* Lightbox */}
      <MediaLightbox state={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

// --- Subcomponents ---

function ActionChip({
  seg,
  actions,
  onSelect,
}: {
  seg: SpanSegment;
  actions: MarketingAction[];
  onSelect: (a: MarketingAction) => void;
}) {
  const isPerformance = seg.planningType === "performance";
  const Icon = isPerformance ? Megaphone : Hash;
  return (
    <div
      className={`relative z-10 flex items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-tight cursor-pointer transition-all hover:brightness-90 hover:shadow-sm ${
        isPerformance ? "perf-stripe border-l-2 border-l-white/70" : ""
      }`}
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
        const action = actions.find((a) => a.id === seg.actionId);
        if (action) onSelect(action);
      }}
    >
      <Icon className="h-2.5 w-2.5 shrink-0 opacity-90" />
      <span className="truncate">{seg.title}</span>
    </div>
  );
}

function MediaPreviewCard({
  media,
  onRemove,
  onExpand,
}: {
  media: MediaItem;
  onRemove?: () => void;
  onExpand?: () => void;
}) {
  const handleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    onExpand?.();
  };
  return (
    <div className="group relative aspect-square rounded-md border border-border bg-background overflow-hidden">
      {/* Clickable thumbnail layer (skip for video so native controls work) */}
      {media.type !== "video" && onExpand ? (
        <button
          type="button"
          onClick={handleExpand}
          className="absolute inset-0 z-[1] cursor-zoom-in"
          title="Ampliar"
          aria-label="Ampliar"
        />
      ) : null}

      {media.type === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={media.url}
          alt={media.filename || "imagem"}
          className="w-full h-full object-cover"
        />
      ) : media.type === "video" ? (
        <video
          src={media.url}
          className="w-full h-full object-cover bg-black"
          controls
          preload="metadata"
        />
      ) : media.type === "pdf" ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-rose-500/10 text-rose-700 dark:text-rose-300">
          <FileText className="h-7 w-7" />
          <span className="text-[10px] mt-1 font-medium">PDF</span>
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-muted text-muted-foreground">
          <Film className="h-7 w-7" />
          <span className="text-[10px] mt-1">Arquivo</span>
        </div>
      )}

      {/* Hover expand button (visible for video too) */}
      {onExpand && (
        <button
          type="button"
          onClick={handleExpand}
          className="absolute top-1 left-1 z-10 h-6 w-6 flex items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-black/80 transition-opacity"
          title="Ampliar"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
      )}

      {/* Overlay with filename + download */}
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent p-1.5 flex items-end justify-between pointer-events-none">
        <span className="text-[10px] text-white truncate max-w-[70%]">
          {media.filename || media.url.split("/").pop()}
          {media.size ? (
            <span className="text-white/60 ml-1">{formatBytes(media.size)}</span>
          ) : null}
        </span>
        <a
          href={media.url}
          target="_blank"
          rel="noopener noreferrer"
          download={media.filename}
          onClick={(e) => e.stopPropagation()}
          className="h-5 w-5 flex items-center justify-center rounded bg-black/40 text-white hover:bg-black/60 pointer-events-auto"
          title="Baixar"
        >
          <Download className="h-3 w-3" />
        </a>
      </div>

      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute top-1 right-1 z-10 h-5 w-5 flex items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-destructive transition-opacity"
          title="Remover"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function MediaLightbox({
  state,
  onClose,
}: {
  state: { items: MediaItem[]; index: number } | null;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (state) setIdx(state.index);
  }, [state]);

  const items = state?.items || [];
  const current = items[idx];
  const hasPrev = idx > 0;
  const hasNext = idx < items.length - 1;

  const goPrev = useCallback(() => {
    setIdx((i) => Math.max(0, i - 1));
  }, []);
  const goNext = useCallback(() => {
    setIdx((i) => Math.min(items.length - 1, i + 1));
  }, [items.length]);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, onClose, goPrev, goNext]);

  if (!state || !current) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Close */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 h-10 w-10 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
        title="Fechar (Esc)"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Filename + counter + download */}
      <div className="absolute top-4 left-4 right-20 flex items-center gap-3 text-white">
        <span className="text-sm font-medium truncate">
          {current.filename || current.url.split("/").pop()}
        </span>
        {current.size ? (
          <span className="text-xs text-white/60 shrink-0">
            {formatBytes(current.size)}
          </span>
        ) : null}
        {items.length > 1 ? (
          <span className="text-xs text-white/60 shrink-0">
            {idx + 1} / {items.length}
          </span>
        ) : null}
        <a
          href={current.url}
          target="_blank"
          rel="noopener noreferrer"
          download={current.filename}
          onClick={(e) => e.stopPropagation()}
          className="ml-auto h-8 w-8 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors shrink-0"
          title="Baixar"
        >
          <Download className="h-4 w-4" />
        </a>
      </div>

      {/* Prev/Next */}
      {items.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            disabled={!hasPrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 h-12 w-12 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Anterior (←)"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            disabled={!hasNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 h-12 w-12 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Proximo (→)"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      {/* Content */}
      <div
        className="max-w-[92vw] max-h-[88vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {current.type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.url}
            alt={current.filename || "imagem"}
            className="max-w-[92vw] max-h-[88vh] object-contain rounded-md shadow-2xl"
          />
        ) : current.type === "video" ? (
          <video
            src={current.url}
            controls
            autoPlay
            className="max-w-[92vw] max-h-[88vh] rounded-md bg-black shadow-2xl"
          />
        ) : current.type === "pdf" ? (
          <iframe
            src={current.url}
            title={current.filename || "PDF"}
            className="w-[92vw] h-[88vh] rounded-md bg-white shadow-2xl"
          />
        ) : (
          <div className="rounded-md bg-card p-12 flex flex-col items-center gap-3 shadow-2xl">
            <Film className="h-16 w-16 text-muted-foreground" />
            <p className="text-sm">Pre-visualizacao indisponivel</p>
            <a
              href={current.url}
              target="_blank"
              rel="noopener noreferrer"
              download={current.filename}
              className="text-sm text-primary hover:underline"
            >
              Abrir arquivo
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
