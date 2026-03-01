"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Save,
  RotateCcw,
  Brain,
  ScrollText,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/lib/workspace-context";
import { getTeamAgentDefaults } from "@/lib/agent/team-agents";

interface AgentInfo {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatar_color: string;
}

export default function TeamAgentSettingsPage() {
  const params = useParams<{ slug: string }>();
  const { workspace } = useWorkspace();

  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [loadingAgent, setLoadingAgent] = useState(true);

  const [soul, setSoul] = useState("");
  const [soulVersion, setSoulVersion] = useState(0);
  const [agentRules, setAgentRules] = useState("");
  const [rulesVersion, setRulesVersion] = useState(0);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [savingDoc, setSavingDoc] = useState<string | null>(null);
  const [docMessage, setDocMessage] = useState("");

  const headers = useCallback(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (workspace?.id) h["x-workspace-id"] = workspace.id;
    return h;
  }, [workspace?.id]);

  // Load agent info
  useEffect(() => {
    if (!workspace?.id || !params.slug) return;

    async function loadAgent() {
      try {
        const res = await fetch("/api/team/agents", {
          headers: { "x-workspace-id": workspace!.id },
        });
        if (res.ok) {
          const data = await res.json();
          const found = (data.agents || []).find(
            (a: AgentInfo) => a.slug === params.slug
          );
          if (found) setAgent(found);
        }
      } catch {
        // Silently fail
      } finally {
        setLoadingAgent(false);
      }
    }

    loadAgent();
  }, [workspace?.id, params.slug]);

  // Load documents once agent is loaded
  const loadDocuments = useCallback(async () => {
    if (!workspace?.id || !agent?.id) return;
    setLoadingDocs(true);
    try {
      const res = await fetch(
        `/api/agent/config?agent_id=${agent.id}`,
        { headers: headers() }
      );
      const data = await res.json();

      const defaults = getTeamAgentDefaults(agent.slug);

      if (data.soul) {
        setSoul(data.soul.content || "");
        setSoulVersion(data.soul.version || 1);
      } else {
        setSoul(defaults?.soul || "");
        setSoulVersion(0);
      }
      if (data.agent_rules) {
        setAgentRules(data.agent_rules.content || "");
        setRulesVersion(data.agent_rules.version || 1);
      } else {
        setAgentRules(defaults?.rules || "");
        setRulesVersion(0);
      }
    } catch {
      const defaults = getTeamAgentDefaults(params.slug || "");
      setSoul(defaults?.soul || "");
      setAgentRules(defaults?.rules || "");
    } finally {
      setLoadingDocs(false);
    }
  }, [workspace?.id, agent?.id, agent?.slug, params.slug, headers]);

  useEffect(() => {
    if (agent) loadDocuments();
  }, [agent, loadDocuments]);

  // Save document
  const saveDocument = async (docType: string, content: string) => {
    if (!agent?.id) return;
    setSavingDoc(docType);
    setDocMessage("");
    try {
      const res = await fetch("/api/agent/config", {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ doc_type: docType, content, agent_id: agent.id }),
      });
      const data = await res.json();
      if (data.document) {
        if (docType === "soul") setSoulVersion(data.document.version);
        if (docType === "agent_rules") setRulesVersion(data.document.version);
        setDocMessage("Salvo com sucesso!");
      } else {
        setDocMessage(`Erro: ${data.error}`);
      }
    } catch {
      setDocMessage("Erro ao salvar.");
    } finally {
      setSavingDoc(null);
      setTimeout(() => setDocMessage(""), 3000);
    }
  };

  if (loadingAgent) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Agente nao encontrado</p>
        <Link href="/team">
          <Button variant="outline" className="mt-4">
            Voltar
          </Button>
        </Link>
      </div>
    );
  }

  const defaults = getTeamAgentDefaults(agent.slug);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/team">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div
          className="flex h-11 w-11 items-center justify-center rounded-full text-white text-lg font-bold shrink-0"
          style={{ backgroundColor: agent.avatar_color }}
        >
          {agent.name[0]}
        </div>
        <div>
          <h1 className="text-2xl font-bold">Configuracoes de {agent.name}</h1>
          <p className="text-sm text-muted-foreground">
            {agent.description}
          </p>
        </div>
      </div>

      {/* Feedback */}
      {docMessage && (
        <div
          className={`rounded-lg px-4 py-2 text-sm ${
            docMessage.includes("Erro")
              ? "bg-red-500/10 text-red-500"
              : "bg-green-500/10 text-green-500"
          }`}
        >
          {docMessage}
        </div>
      )}

      <Tabs defaultValue="soul" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="soul" className="gap-1.5">
            <Brain className="h-4 w-4" />
            Personalidade
          </TabsTrigger>
          <TabsTrigger value="rules" className="gap-1.5">
            <ScrollText className="h-4 w-4" />
            Regras
          </TabsTrigger>
        </TabsList>

        {/* Soul */}
        <TabsContent value="soul">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Personalidade (Soul)</CardTitle>
                  <CardDescription>
                    Define a identidade, tom e estilo de comunicacao de {agent.name}.
                  </CardDescription>
                </div>
                {soulVersion > 0 && (
                  <Badge variant="outline">v{soulVersion}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingDocs ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <textarea
                    value={soul}
                    onChange={(e) => setSoul(e.target.value)}
                    className="w-full min-h-[400px] rounded-lg border border-border bg-background p-4 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                    placeholder="Personalidade do agente em markdown..."
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => saveDocument("soul", soul)}
                      disabled={savingDoc === "soul"}
                    >
                      {savingDoc === "soul" ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Salvar
                    </Button>
                    {defaults && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (
                            confirm(
                              "Restaurar a personalidade padrao? Suas edicoes serao perdidas."
                            )
                          ) {
                            setSoul(defaults.soul);
                          }
                        }}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Restaurar Padrao
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Rules */}
        <TabsContent value="rules">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Regras do Agente</CardTitle>
                  <CardDescription>
                    Regras de comportamento e formato de respostas de {agent.name}.
                  </CardDescription>
                </div>
                {rulesVersion > 0 && (
                  <Badge variant="outline">v{rulesVersion}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingDocs ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <textarea
                    value={agentRules}
                    onChange={(e) => setAgentRules(e.target.value)}
                    className="w-full min-h-[400px] rounded-lg border border-border bg-background p-4 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                    placeholder="Regras de comportamento do agente em markdown..."
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => saveDocument("agent_rules", agentRules)}
                      disabled={savingDoc === "agent_rules"}
                    >
                      {savingDoc === "agent_rules" ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Salvar
                    </Button>
                    {defaults && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (
                            confirm(
                              "Restaurar as regras padrao? Suas edicoes serao perdidas."
                            )
                          ) {
                            setAgentRules(defaults.rules);
                          }
                        }}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Restaurar Padrao
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
