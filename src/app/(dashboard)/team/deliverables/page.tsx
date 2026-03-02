"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Loader2,
  Filter,
  Calendar,
  FileText,
  Search,
  Target,
  BarChart3,
  Mail,
  File,
  ClipboardCheck,
  FolderOpen,
  FolderCheck,
  AlertCircle,
  CheckCircle2,
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

interface Deliverable {
  id: string;
  title: string;
  content: string;
  deliverable_type: string;
  format: string;
  metadata: Record<string, unknown>;
  status: string;
  created_at: string;
  agent: Agent | null;
  task: { id: string; title: string } | null;
  project: { id: string; title: string; status: string } | null;
}

const TYPE_CONFIG: Record<
  string,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
  }
> = {
  calendar: { label: "Calendario", icon: Calendar, color: "text-amber-500" },
  copy: { label: "Copy", icon: FileText, color: "text-pink-500" },
  audit: { label: "Auditoria", icon: Search, color: "text-green-500" },
  strategy: { label: "Estrategia", icon: Target, color: "text-violet-500" },
  report: { label: "Relatorio", icon: BarChart3, color: "text-blue-500" },
  email_sequence: { label: "Emails", icon: Mail, color: "text-orange-500" },
  general: { label: "Geral", icon: File, color: "text-gray-500" },
  compiled: {
    label: "Compilado",
    icon: FolderCheck,
    color: "text-indigo-500",
  },
};

function getContentPreview(del: Deliverable): {
  text: string;
  isEmpty: boolean;
} {
  if (!del.content || del.content.trim().length < 50) {
    return { text: "Vazio", isEmpty: true };
  }

  // Calendar: try to count entries
  if (del.deliverable_type === "calendar") {
    try {
      if (del.metadata?.entries) {
        const entries = del.metadata.entries as unknown[];
        return { text: `${entries.length} entradas`, isEmpty: false };
      }
      if (del.format === "json") {
        const parsed = JSON.parse(del.content);
        const entries = parsed.entries || parsed;
        if (Array.isArray(entries)) {
          return { text: `${entries.length} entradas`, isEmpty: false };
        }
      }
    } catch {
      // Fall through to word count
    }
  }

  // Word count
  const words = del.content.trim().split(/\s+/).length;
  if (words < 1000) {
    return { text: `${words} palavras`, isEmpty: false };
  }
  return {
    text: `${(words / 1000).toFixed(1)}k palavras`,
    isEmpty: false,
  };
}

interface ProjectGroup {
  projectId: string | null;
  projectTitle: string;
  projectStatus: string | null;
  deliverables: Deliverable[];
}

export default function DeliverablesPage() {
  const { workspace } = useWorkspace();
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAgent, setFilterAgent] = useState("");
  const [filterType, setFilterType] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (!workspace?.id) return;

    async function loadData() {
      try {
        const params = new URLSearchParams();
        if (filterAgent) params.set("agent_id", filterAgent);
        if (filterType) params.set("deliverable_type", filterType);

        const [delRes, agentsRes] = await Promise.all([
          fetch(`/api/team/deliverables?${params}`, {
            headers: { "x-workspace-id": workspace!.id },
          }),
          fetch("/api/team/agents", {
            headers: { "x-workspace-id": workspace!.id },
          }),
        ]);

        if (delRes.ok) {
          const data = await delRes.json();
          setDeliverables(data.deliverables || []);
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
    }

    loadData();
  }, [workspace?.id, filterAgent, filterType]);

  // Group deliverables by project
  const groups = useMemo<ProjectGroup[]>(() => {
    const projectMap = new Map<string, ProjectGroup>();

    for (const del of deliverables) {
      const key = del.project?.id || "__none__";

      if (!projectMap.has(key)) {
        projectMap.set(key, {
          projectId: del.project?.id || null,
          projectTitle: del.project?.title || "Sem projeto",
          projectStatus: del.project?.status || null,
          deliverables: [],
        });
      }
      projectMap.get(key)!.deliverables.push(del);
    }

    // Sort: projects with deliverables first (by date), "sem projeto" last
    const sorted = Array.from(projectMap.values()).sort((a, b) => {
      if (a.projectId === null) return 1;
      if (b.projectId === null) return -1;
      // Sort by most recent deliverable
      const aDate = a.deliverables[0]?.created_at || "";
      const bDate = b.deliverables[0]?.created_at || "";
      return bDate.localeCompare(aDate);
    });

    // Within each group: compiled first, then by date
    for (const group of sorted) {
      group.deliverables.sort((a, b) => {
        if (a.deliverable_type === "compiled") return -1;
        if (b.deliverable_type === "compiled") return 1;
        return b.created_at.localeCompare(a.created_at);
      });
    }

    return sorted;
  }, [deliverables]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Entregas</h1>
          <p className="text-muted-foreground mt-1">
            {deliverables.length} entregas do time
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
                  {Object.entries(TYPE_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {deliverables.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <ClipboardCheck className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold">Nenhuma entrega ainda</h3>
            <p className="text-muted-foreground mt-1">
              As entregas do time aparecerao aqui quando forem criadas via chat
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.projectId || "none"}>
              {/* Group header */}
              <div className="flex items-center gap-2 mb-3">
                {group.projectId ? (
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <File className="h-4 w-4 text-muted-foreground" />
                )}
                <h2 className="text-sm font-semibold">
                  {group.projectTitle}
                </h2>
                {group.projectStatus === "done" && (
                  <Badge
                    variant="outline"
                    className="text-[10px] text-green-600 border-green-600/30"
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Concluido
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {group.deliverables.length} entrega
                  {group.deliverables.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Table */}
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left font-medium px-4 py-2.5 w-[100px]">
                          Tipo
                        </th>
                        <th className="text-left font-medium px-4 py-2.5">
                          Titulo
                        </th>
                        <th className="text-left font-medium px-4 py-2.5 w-[120px]">
                          Conteudo
                        </th>
                        <th className="text-left font-medium px-4 py-2.5 w-[140px]">
                          Agente
                        </th>
                        <th className="text-left font-medium px-4 py-2.5 w-[180px] hidden lg:table-cell">
                          Tarefa
                        </th>
                        <th className="text-left font-medium px-4 py-2.5 w-[80px]">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.deliverables.map((del) => {
                        const typeConf =
                          TYPE_CONFIG[del.deliverable_type] ||
                          TYPE_CONFIG.general;
                        const TypeIcon = typeConf.icon;
                        const preview = getContentPreview(del);
                        const isCompiled =
                          del.deliverable_type === "compiled";

                        return (
                          <Link
                            key={del.id}
                            href={`/team/deliverables/${del.id}`}
                            className={cn(
                              "table-row border-b last:border-b-0 hover:bg-accent/50 transition-colors cursor-pointer",
                              preview.isEmpty && "opacity-50",
                              isCompiled && "bg-indigo-500/5"
                            )}
                          >
                            {/* Type */}
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                <TypeIcon
                                  className={cn(
                                    "h-4 w-4 shrink-0",
                                    typeConf.color
                                  )}
                                />
                                <span className="text-xs font-medium">
                                  {typeConf.label}
                                </span>
                              </div>
                            </td>

                            {/* Title */}
                            <td className="px-4 py-3">
                              <span className="text-sm font-medium line-clamp-1">
                                {del.title}
                              </span>
                            </td>

                            {/* Content preview */}
                            <td className="px-4 py-3">
                              {preview.isEmpty ? (
                                <div className="flex items-center gap-1 text-amber-500">
                                  <AlertCircle className="h-3.5 w-3.5" />
                                  <span className="text-xs font-medium">
                                    Vazio
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  {preview.text}
                                </span>
                              )}
                            </td>

                            {/* Agent */}
                            <td className="px-4 py-3">
                              {del.agent && (
                                <div className="flex items-center gap-1.5">
                                  <div
                                    className="h-5 w-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center shrink-0"
                                    style={{
                                      backgroundColor:
                                        del.agent.avatar_color,
                                    }}
                                  >
                                    {del.agent.name[0]}
                                  </div>
                                  <span className="text-xs truncate max-w-[100px]">
                                    {del.agent.name}
                                  </span>
                                </div>
                              )}
                            </td>

                            {/* Task */}
                            <td className="px-4 py-3 hidden lg:table-cell">
                              {del.task ? (
                                <span className="text-xs text-muted-foreground truncate block max-w-[160px]">
                                  {del.task.title}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground/50">
                                  —
                                </span>
                              )}
                            </td>

                            {/* Status */}
                            <td className="px-4 py-3">
                              <Badge
                                variant={
                                  del.status === "final"
                                    ? "default"
                                    : "secondary"
                                }
                                className="text-[10px]"
                              >
                                {del.status === "final"
                                  ? "Final"
                                  : "Rascunho"}
                              </Badge>
                            </td>
                          </Link>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
