"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Loader2,
  Filter,
  Calendar,
  FileText,
  Search,
  ClipboardCheck,
  Target,
  BarChart3,
  Mail,
  File,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace-context";

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
  format: string;
  status: string;
  created_at: string;
  agent: Agent | null;
}

const TYPE_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  calendar: { label: "Calendario", icon: Calendar, color: "text-amber-500" },
  copy: { label: "Copy", icon: FileText, color: "text-pink-500" },
  audit: { label: "Auditoria", icon: Search, color: "text-green-500" },
  strategy: { label: "Estrategia", icon: Target, color: "text-violet-500" },
  report: { label: "Relatorio", icon: BarChart3, color: "text-blue-500" },
  email_sequence: { label: "Emails", icon: Mail, color: "text-orange-500" },
  general: { label: "Geral", icon: File, color: "text-gray-500" },
};

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
            Todas as entregas do time em um lugar
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {deliverables.map((del) => {
            const typeConf = TYPE_CONFIG[del.deliverable_type] || TYPE_CONFIG.general;
            const TypeIcon = typeConf.icon;

            return (
              <Link key={del.id} href={`/team/deliverables/${del.id}`}>
                <Card className="hover:border-primary/30 transition-colors cursor-pointer h-full">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 ${typeConf.color}`}>
                        <TypeIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold truncate">{del.title}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-[10px]">
                            {typeConf.label}
                          </Badge>
                          <Badge
                            variant={del.status === "final" ? "default" : "secondary"}
                            className="text-[10px]"
                          >
                            {del.status === "final" ? "Final" : "Rascunho"}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                      {del.agent && (
                        <div className="flex items-center gap-1.5">
                          <div
                            className="h-5 w-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
                            style={{
                              backgroundColor: del.agent.avatar_color,
                            }}
                          >
                            {del.agent.name[0]}
                          </div>
                          <span>{del.agent.name}</span>
                        </div>
                      )}
                      <span>
                        {new Date(del.created_at).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
