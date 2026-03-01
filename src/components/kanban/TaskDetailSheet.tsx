"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  Calendar,
  FileText,
  FolderOpen,
  Loader2,
  ExternalLink,
} from "lucide-react";
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
  deliverable_type: string;
  status: string;
  created_at: string;
  agent: Agent | null;
}

interface Project {
  id: string;
  title: string;
  status: string;
}

interface TaskDetail {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  task_type: string;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  agent: Agent | null;
  created_by_agent: Agent | null;
  project: Project | null;
  deliverables: Deliverable[];
}

interface TaskDetailSheetProps {
  taskId: string | null;
  open: boolean;
  onClose: () => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  urgent: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

const TYPE_LABELS: Record<string, string> = {
  copy: "Copy",
  seo: "SEO",
  social_calendar: "Social",
  campaign: "Campanha",
  cro: "CRO",
  strategy: "Estrategia",
  revenue: "Revenue",
  general: "Geral",
};

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "Em Progresso",
  review: "Revisao",
  done: "Concluido",
};

const DELIVERABLE_TYPE_LABELS: Record<string, string> = {
  calendar: "Calendario",
  copy: "Copy",
  audit: "Auditoria",
  strategy: "Estrategia",
  report: "Relatorio",
  email_sequence: "Emails",
  general: "Geral",
  compiled: "Compilado",
};

function AgentBadge({ agent, label }: { agent: Agent; label: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <div
          className="h-7 w-7 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0"
          style={{ backgroundColor: agent.avatar_color }}
        >
          {agent.name[0]}
        </div>
        <span className="text-sm font-medium">{agent.name}</span>
      </div>
    </div>
  );
}

export function TaskDetailSheet({
  taskId,
  open,
  onClose,
}: TaskDetailSheetProps) {
  const { workspace } = useWorkspace();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !taskId || !workspace?.id) {
      setTask(null);
      return;
    }

    setLoading(true);
    fetch(`/api/team/tasks/${taskId}`, {
      headers: { "x-workspace-id": workspace.id },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setTask(data?.task || null))
      .catch(() => setTask(null))
      .finally(() => setLoading(false));
  }, [open, taskId, workspace?.id]);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !task ? (
          <div className="text-center py-12 text-muted-foreground">
            Tarefa nao encontrada
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="text-left pr-6">{task.title}</SheetTitle>
              {task.description && (
                <SheetDescription className="text-left whitespace-pre-wrap">
                  {task.description}
                </SheetDescription>
              )}
            </SheetHeader>

            <div className="space-y-6 mt-6">
              {/* Badges */}
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  {STATUS_LABELS[task.status] || task.status}
                </Badge>
                <Badge className={cn(PRIORITY_COLORS[task.priority])}>
                  {task.priority}
                </Badge>
                <Badge variant="secondary">
                  {TYPE_LABELS[task.task_type] || task.task_type}
                </Badge>
              </div>

              {/* Agents */}
              <div className="grid grid-cols-2 gap-4">
                {task.agent && (
                  <AgentBadge agent={task.agent} label="Responsavel" />
                )}
                {task.created_by_agent && (
                  <AgentBadge
                    agent={task.created_by_agent}
                    label="Criado por"
                  />
                )}
              </div>

              {/* Project */}
              {task.project && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Projeto
                  </p>
                  <div className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{task.project.title}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {task.project.status}
                    </Badge>
                  </div>
                </div>
              )}

              {/* Dates */}
              <div className="flex gap-4 text-sm text-muted-foreground">
                <div>
                  <p className="text-xs font-medium mb-0.5">Criado em</p>
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(task.created_at).toLocaleDateString("pt-BR")}
                  </div>
                </div>
                {task.due_date && (
                  <div>
                    <p className="text-xs font-medium mb-0.5">Prazo</p>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {new Date(task.due_date).toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                )}
                {task.completed_at && (
                  <div>
                    <p className="text-xs font-medium mb-0.5">Concluido em</p>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {new Date(task.completed_at).toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                )}
              </div>

              {/* Deliverables */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Entregas ({task.deliverables.length})
                </p>
                {task.deliverables.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">
                    Nenhuma entrega vinculada
                  </p>
                ) : (
                  <div className="space-y-2">
                    {task.deliverables.map((d) => (
                      <Link
                        key={d.id}
                        href={`/team/deliverables/${d.id}`}
                        className="flex items-center gap-3 p-2.5 rounded-md border hover:bg-accent transition-colors"
                      >
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {d.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {DELIVERABLE_TYPE_LABELS[d.deliverable_type] ||
                              d.deliverable_type}{" "}
                            -{" "}
                            {d.status === "final" ? "Final" : "Rascunho"}
                            {d.agent && ` - ${d.agent.name}`}
                          </p>
                        </div>
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
