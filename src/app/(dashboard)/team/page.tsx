"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Users,
  MessageSquare,
  FileOutput,
  Loader2,
  Crown,
  Settings,
  LayoutGrid,
  Building2,
  Briefcase,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace-context";

const PixelOffice = dynamic(
  () =>
    import("@/components/pixel-office/PixelOffice").then(
      (mod) => mod.PixelOffice
    ),
  { ssr: false }
);

interface AgentWithStats {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatar_color: string;
  is_default: boolean;
  status: string;
  active_tasks: number;
  total_deliverables: number;
  active_task_title: string | null;
}

export default function TeamPage() {
  const { workspace } = useWorkspace();
  const [agents, setAgents] = useState<AgentWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"office" | "grid">("office");

  useEffect(() => {
    if (!workspace?.id) return;

    async function loadAgents() {
      try {
        const res = await fetch("/api/team/agents", {
          headers: { "x-workspace-id": workspace!.id },
        });
        if (res.ok) {
          const data = await res.json();
          setAgents(data.agents || []);
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }

    loadAgents();
  }, [workspace?.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const coordinator = agents.find((a) => a.slug === "coordenador");
  const teamMembers = agents.filter((a) => a.slug !== "coordenador");

  return (
    <div className="space-y-8">
      {/* Header with view toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Time de Marketing
          </h1>
          <p className="text-muted-foreground mt-1">
            Seu time de especialistas prontos para trabalhar
          </p>
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          <button
            onClick={() => setViewMode("office")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
              viewMode === "office"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Building2 className="h-4 w-4" />
            <span className="hidden sm:inline">Escritorio</span>
          </button>
          <button
            onClick={() => setViewMode("grid")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
              viewMode === "grid"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline">Grid</span>
          </button>
        </div>
      </div>

      {/* Office View */}
      {viewMode === "office" && <PixelOffice agents={agents} />}

      {/* Grid View (original) */}
      {viewMode === "grid" && (
        <>
          {/* Coordinator card - highlighted */}
          {coordinator && (
            <Card
              className="border-2"
              style={{ borderColor: coordinator.avatar_color + "40" }}
            >
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-full text-white text-xl font-bold shrink-0"
                    style={{ backgroundColor: coordinator.avatar_color }}
                  >
                    {coordinator.name[0]}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold">
                        {coordinator.name}
                      </h2>
                      <Crown className="h-5 w-5 text-yellow-500" />
                      <Badge variant="outline" className="text-xs">
                        Coordenador
                      </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1">
                      {coordinator.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/team/agents/${coordinator.slug}/settings`}
                    >
                      <Button variant="outline" size="icon">
                        <Settings className="h-4 w-4" />
                      </Button>
                    </Link>
                    <Link href={`/team/chat?agent=${coordinator.slug}`}>
                      <Button>
                        <MessageSquare className="h-4 w-4 mr-2" />
                        Conversar
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Team grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {teamMembers.map((agent) => (
              <Card
                key={agent.id}
                className="hover:border-primary/30 transition-colors"
              >
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <div
                      className="flex h-11 w-11 items-center justify-center rounded-full text-white text-lg font-bold shrink-0"
                      style={{ backgroundColor: agent.avatar_color }}
                    >
                      {agent.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate">{agent.name}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {agent.description}
                      </p>
                    </div>
                  </div>

                  {/* Active task or available status */}
                  <div className="mt-3">
                    {agent.active_task_title ? (
                      <div className="flex items-start gap-1.5 text-xs">
                        <Briefcase className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                        <span className="text-muted-foreground line-clamp-2">
                          {agent.active_task_title}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <div className="w-2 h-2 rounded-full bg-gray-400" />
                        Disponivel
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {agent.active_tasks} tarefas
                    </span>
                    <span className="flex items-center gap-1">
                      <FileOutput className="h-3.5 w-3.5" />
                      {agent.total_deliverables} entregas
                    </span>
                  </div>

                  <div className="flex gap-2 mt-4">
                    <Link
                      href={`/team/chat?agent=${agent.slug}`}
                      className="flex-1"
                    >
                      <Button variant="outline" size="sm" className="w-full">
                        <MessageSquare className="h-4 w-4 mr-2" />
                        Conversar
                      </Button>
                    </Link>
                    <Link href={`/team/agents/${agent.slug}/settings`}>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
