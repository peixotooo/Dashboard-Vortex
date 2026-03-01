"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  Plus,
  Filter,
  Calendar,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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

interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  task_type: string;
  due_date: string | null;
  created_at: string;
  agent: Agent | null;
}

const COLUMNS = [
  { key: "backlog", label: "Backlog", color: "bg-gray-500" },
  { key: "todo", label: "To Do", color: "bg-blue-500" },
  { key: "in_progress", label: "Em Progresso", color: "bg-yellow-500" },
  { key: "review", label: "Revisao", color: "bg-purple-500" },
  { key: "done", label: "Concluido", color: "bg-green-500" },
];

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

export default function KanbanPage() {
  const { workspace } = useWorkspace();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAgent, setFilterAgent] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);

  const loadData = useCallback(async () => {
    if (!workspace?.id) return;

    try {
      const [tasksRes, agentsRes] = await Promise.all([
        fetch("/api/team/tasks", {
          headers: { "x-workspace-id": workspace.id },
        }),
        fetch("/api/team/agents", {
          headers: { "x-workspace-id": workspace.id },
        }),
      ]);

      if (tasksRes.ok) {
        const data = await tasksRes.json();
        setTasks(data.tasks || []);
      }
      if (agentsRes.ok) {
        const data = await agentsRes.json();
        setAgents(data.agents || []);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const updateTaskStatus = async (taskId: string, newStatus: string) => {
    if (!workspace?.id) return;

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
    );

    try {
      await fetch(`/api/team/tasks/${taskId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspace.id,
        },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch {
      // Revert on error
      loadData();
    }
  };

  const filteredTasks = tasks.filter((t) => {
    if (filterAgent && t.agent?.id !== filterAgent) return false;
    if (filterType && t.task_type !== filterType) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Kanban</h1>
          <p className="text-muted-foreground mt-1">
            Gerencie as tarefas do time
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="h-4 w-4 mr-2" />
          Filtros
        </Button>
      </div>

      {/* Filters */}
      {showFilters && (
        <Card>
          <CardContent className="p-4">
            <div className="flex gap-4 flex-wrap">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  Agente
                </label>
                <select
                  value={filterAgent}
                  onChange={(e) => setFilterAgent(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Todos</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  Tipo
                </label>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Todos</option>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Kanban columns */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const columnTasks = filteredTasks.filter(
            (t) => t.status === col.key
          );

          return (
            <div
              key={col.key}
              className="flex-1 min-w-[260px] max-w-[320px]"
            >
              {/* Column header */}
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className={cn("h-2.5 w-2.5 rounded-full", col.color)} />
                <h3 className="text-sm font-semibold">{col.label}</h3>
                <Badge variant="secondary" className="text-xs ml-auto">
                  {columnTasks.length}
                </Badge>
              </div>

              {/* Cards */}
              <div className="space-y-2">
                {columnTasks.map((task) => (
                  <Card
                    key={task.id}
                    className="cursor-pointer hover:border-primary/30 transition-colors"
                  >
                    <CardContent className="p-3">
                      <h4 className="text-sm font-medium line-clamp-2">
                        {task.title}
                      </h4>

                      {task.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {task.description}
                        </p>
                      )}

                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "text-[10px] px-1.5 py-0",
                            PRIORITY_COLORS[task.priority]
                          )}
                        >
                          {task.priority}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {TYPE_LABELS[task.task_type] || task.task_type}
                        </Badge>
                      </div>

                      <div className="flex items-center justify-between mt-2">
                        {task.agent && (
                          <div className="flex items-center gap-1.5">
                            <div
                              className="h-5 w-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
                              style={{
                                backgroundColor: task.agent.avatar_color,
                              }}
                            >
                              {task.agent.name[0]}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {task.agent.name}
                            </span>
                          </div>
                        )}

                        {task.due_date && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(task.due_date).toLocaleDateString(
                              "pt-BR",
                              {
                                day: "2-digit",
                                month: "2-digit",
                              }
                            )}
                          </span>
                        )}
                      </div>

                      {/* Quick status change */}
                      {col.key !== "done" && (
                        <div className="mt-2 pt-2 border-t border-border">
                          <div className="flex gap-1">
                            {COLUMNS.filter((c) => c.key !== col.key)
                              .slice(0, 3)
                              .map((c) => (
                                <button
                                  key={c.key}
                                  onClick={() =>
                                    updateTaskStatus(task.id, c.key)
                                  }
                                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-accent"
                                >
                                  {c.label}
                                </button>
                              ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}

                {columnTasks.length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-8 border border-dashed rounded-lg">
                    Nenhuma tarefa
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
