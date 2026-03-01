"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  ArrowLeft,
  Calendar,
  FileText,
  Search,
  Target,
  BarChart3,
  Mail,
  File,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

interface Agent {
  id: string;
  name: string;
  slug: string;
  avatar_color: string;
}

interface Deliverable {
  id: string;
  title: string;
  content: string;
  deliverable_type: string;
  format: string;
  metadata: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
  agent: Agent | null;
}

interface CalendarEntry {
  date: string;
  platform: string;
  format: string;
  hook: string;
  content: string;
  pillar: string;
}

const PILLAR_COLORS: Record<string, string> = {
  educativo: "bg-blue-100 border-blue-300 dark:bg-blue-950 dark:border-blue-800",
  inspiracional: "bg-purple-100 border-purple-300 dark:bg-purple-950 dark:border-purple-800",
  promocional: "bg-green-100 border-green-300 dark:bg-green-950 dark:border-green-800",
  autoridade: "bg-orange-100 border-orange-300 dark:bg-orange-950 dark:border-orange-800",
  engajamento: "bg-pink-100 border-pink-300 dark:bg-pink-950 dark:border-pink-800",
  bastidores: "bg-amber-100 border-amber-300 dark:bg-amber-950 dark:border-amber-800",
};

function CalendarView({ entries }: { entries: CalendarEntry[] }) {
  if (!entries || entries.length === 0) {
    return <p className="text-muted-foreground">Nenhuma entrada no calendario</p>;
  }

  // Group by date
  const grouped: Record<string, CalendarEntry[]> = {};
  for (const entry of entries) {
    if (!grouped[entry.date]) grouped[entry.date] = [];
    grouped[entry.date].push(entry);
  }

  const sortedDates = Object.keys(grouped).sort();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {sortedDates.map((date) => (
        <Card key={date} className="overflow-hidden">
          <div className="bg-primary/10 px-3 py-2">
            <span className="text-sm font-semibold">
              {new Date(date + "T12:00:00").toLocaleDateString("pt-BR", {
                weekday: "short",
                day: "2-digit",
                month: "short",
              })}
            </span>
          </div>
          <CardContent className="p-3 space-y-2">
            {grouped[date].map((entry, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-lg border p-2.5",
                  PILLAR_COLORS[entry.pillar] || "bg-gray-100 border-gray-300 dark:bg-gray-900 dark:border-gray-700"
                )}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {entry.platform}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {entry.format}
                  </Badge>
                </div>
                {entry.hook && (
                  <p className="text-xs font-medium">{entry.hook}</p>
                )}
                {entry.content && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-3">
                    {entry.content}
                  </p>
                )}
                <Badge variant="outline" className="text-[9px] mt-1.5 px-1 py-0">
                  {entry.pillar}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AuditView({ content }: { content: string }) {
  // Parse markdown audit content with status indicators
  const lines = content.split("\n");

  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;

        // Detect status markers
        let StatusIcon = null;
        let statusColor = "";

        if (trimmed.includes("[OK]") || trimmed.includes("[ok]") || trimmed.includes("✅")) {
          StatusIcon = CheckCircle2;
          statusColor = "text-green-500";
        } else if (trimmed.includes("[WARN]") || trimmed.includes("[warning]") || trimmed.includes("⚠")) {
          StatusIcon = AlertTriangle;
          statusColor = "text-yellow-500";
        } else if (trimmed.includes("[ERROR]") || trimmed.includes("[error]") || trimmed.includes("❌")) {
          StatusIcon = XCircle;
          statusColor = "text-red-500";
        }

        if (trimmed.startsWith("#")) {
          const level = trimmed.match(/^#+/)?.[0].length || 1;
          const text = trimmed.replace(/^#+\s*/, "");
          const Tag = level <= 2 ? "h2" : "h3";
          return (
            <Tag key={i} className={cn("font-bold mt-4", level <= 2 ? "text-lg" : "text-base")}>
              {text}
            </Tag>
          );
        }

        if (StatusIcon) {
          return (
            <div key={i} className="flex items-start gap-2 py-1">
              <StatusIcon className={cn("h-4 w-4 mt-0.5 shrink-0", statusColor)} />
              <span className="text-sm">{trimmed.replace(/\[(OK|WARN|ERROR|ok|warning|error)\]\s*/i, "").replace(/[✅⚠❌]\s*/, "")}</span>
            </div>
          );
        }

        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <div key={i} className="flex items-start gap-2 py-0.5 pl-2">
              <span className="text-muted-foreground mt-0.5">-</span>
              <span className="text-sm">{trimmed.slice(2)}</span>
            </div>
          );
        }

        return (
          <p key={i} className="text-sm">
            {trimmed}
          </p>
        );
      })}
    </div>
  );
}

function EmailSequenceView({ content }: { content: string }) {
  // Split by email separators
  const emails = content.split(/---+/).filter((s) => s.trim());

  return (
    <div className="space-y-4">
      {emails.map((email, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-orange-500" />
              <CardTitle className="text-sm">Email {i + 1}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-sm whitespace-pre-wrap">{email.trim()}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function StrategyView({ content }: { content: string }) {
  // Parse phases from markdown
  const sections = content.split(/^##\s+/m).filter((s) => s.trim());

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-6 top-8 bottom-4 w-0.5 bg-border" />

      <div className="space-y-6">
        {sections.map((section, i) => {
          const lines = section.split("\n");
          const title = lines[0]?.trim();
          const body = lines.slice(1).join("\n").trim();

          return (
            <div key={i} className="flex gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary font-bold shrink-0 z-10">
                {i + 1}
              </div>
              <div className="flex-1 pt-2">
                <h3 className="font-semibold text-lg">{title}</h3>
                <div className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                  {body}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MarkdownView({ content }: { content: string }) {
  return <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">{content}</div>;
}

export default function DeliverableDetailPage() {
  const params = useParams();
  const { workspace } = useWorkspace();
  const [deliverable, setDeliverable] = useState<Deliverable | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspace?.id || !params.id) return;

    async function load() {
      try {
        const res = await fetch(`/api/team/deliverables/${params.id}`, {
          headers: { "x-workspace-id": workspace!.id },
        });
        if (res.ok) {
          const data = await res.json();
          setDeliverable(data.deliverable);
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [workspace?.id, params.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!deliverable) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Entrega nao encontrada</p>
        <Link href="/team/deliverables">
          <Button variant="outline" className="mt-4">
            Voltar
          </Button>
        </Link>
      </div>
    );
  }

  const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
    calendar: Calendar,
    copy: FileText,
    audit: Search,
    strategy: Target,
    report: BarChart3,
    email_sequence: Mail,
    general: File,
  };
  const TypeIcon = typeIcons[deliverable.deliverable_type] || File;

  // Parse calendar entries from metadata or JSON content
  let calendarEntries: CalendarEntry[] = [];
  if (deliverable.deliverable_type === "calendar") {
    if (deliverable.metadata?.entries) {
      calendarEntries = deliverable.metadata.entries as CalendarEntry[];
    } else if (deliverable.format === "json") {
      try {
        const parsed = JSON.parse(deliverable.content);
        calendarEntries = parsed.entries || parsed;
      } catch {
        // Not valid JSON
      }
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/team/deliverables">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <TypeIcon className="h-6 w-6 text-muted-foreground" />
            <h1 className="text-2xl font-bold">{deliverable.title}</h1>
          </div>
          <div className="flex items-center gap-3 mt-2">
            {deliverable.agent && (
              <div className="flex items-center gap-1.5">
                <div
                  className="h-6 w-6 rounded-full text-white text-xs font-bold flex items-center justify-center"
                  style={{
                    backgroundColor: deliverable.agent.avatar_color,
                  }}
                >
                  {deliverable.agent.name[0]}
                </div>
                <span className="text-sm text-muted-foreground">
                  {deliverable.agent.name}
                </span>
              </div>
            )}
            <Badge
              variant={deliverable.status === "final" ? "default" : "secondary"}
            >
              {deliverable.status === "final" ? "Final" : "Rascunho"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {new Date(deliverable.created_at).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
      </div>

      {/* Content — type-specific rendering */}
      <Card>
        <CardContent className="p-6">
          {deliverable.deliverable_type === "calendar" && calendarEntries.length > 0 ? (
            <CalendarView entries={calendarEntries} />
          ) : deliverable.deliverable_type === "audit" ? (
            <AuditView content={deliverable.content} />
          ) : deliverable.deliverable_type === "strategy" ? (
            <StrategyView content={deliverable.content} />
          ) : deliverable.deliverable_type === "email_sequence" ? (
            <EmailSequenceView content={deliverable.content} />
          ) : (
            <MarkdownView content={deliverable.content} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
