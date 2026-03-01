"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Save,
  RotateCcw,
  Trash2,
  Pencil,
  Building2,
  Brain,
  ScrollText,
  UserCircle,
  Database,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/lib/workspace-context";
import { useAccount } from "@/lib/account-context";
import { DEFAULT_SOUL, DEFAULT_AGENT_RULES } from "@/lib/agent/default-documents";

// --- Types ---

interface AgentDocument {
  id: string;
  doc_type: string;
  content: string;
  version: number;
  updated_at: string;
}

interface CoreMemory {
  id: string;
  category: string;
  key: string;
  value: string;
  updated_at: string;
}

interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

// --- Category colors ---

const CATEGORY_COLORS: Record<string, string> = {
  targeting: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  budget: "bg-green-500/10 text-green-500 border-green-500/20",
  naming: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  preference: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  general: "bg-slate-500/10 text-slate-500 border-slate-500/20",
};

// --- Component ---

export default function AgentSettingsPage() {
  const { workspace } = useWorkspace();
  const { accountId, accounts } = useAccount();

  // Documents
  const [soul, setSoul] = useState("");
  const [soulVersion, setSoulVersion] = useState(1);
  const [agentRules, setAgentRules] = useState("");
  const [rulesVersion, setRulesVersion] = useState(1);
  const [userProfile, setUserProfile] = useState("");
  const [profileVersion, setProfileVersion] = useState(1);
  const [projectContext, setProjectContext] = useState("");
  const [projectContextVersion, setProjectContextVersion] = useState(0);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [savingDoc, setSavingDoc] = useState<string | null>(null);
  const [docMessage, setDocMessage] = useState("");

  // Memories
  const [memories, setMemories] = useState<CoreMemory[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [editingMemory, setEditingMemory] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [memoryMessage, setMemoryMessage] = useState("");

  // Conversations
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [expandedConv, setExpandedConv] = useState<string | null>(null);
  const [convMessages, setConvMessages] = useState<ConversationMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const headers = useCallback(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (workspace?.id) h["x-workspace-id"] = workspace.id;
    return h;
  }, [workspace?.id]);

  // --- Load documents ---

  const loadDocuments = useCallback(async () => {
    if (!workspace?.id) return;
    setLoadingDocs(true);
    try {
      const res = await fetch(`/api/agent/config`, { headers: headers() });
      const data = await res.json();
      if (data.soul) {
        setSoul(data.soul.content || "");
        setSoulVersion(data.soul.version || 1);
      } else {
        setSoul(DEFAULT_SOUL);
        setSoulVersion(0);
      }
      if (data.agent_rules) {
        setAgentRules(data.agent_rules.content || "");
        setRulesVersion(data.agent_rules.version || 1);
      } else {
        setAgentRules(DEFAULT_AGENT_RULES);
        setRulesVersion(0);
      }
      if (data.user_profile) {
        setUserProfile(data.user_profile.content || "");
        setProfileVersion(data.user_profile.version || 1);
      } else {
        setUserProfile("");
        setProfileVersion(0);
      }
      if (data.project_context) {
        setProjectContext(data.project_context.content || "");
        setProjectContextVersion(data.project_context.version || 1);
      } else {
        setProjectContext("");
        setProjectContextVersion(0);
      }
    } catch {
      setSoul(DEFAULT_SOUL);
      setAgentRules(DEFAULT_AGENT_RULES);
    } finally {
      setLoadingDocs(false);
    }
  }, [workspace?.id, headers]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  // --- Save document ---

  const saveDocument = async (docType: string, content: string) => {
    setSavingDoc(docType);
    setDocMessage("");
    try {
      const res = await fetch(`/api/agent/config`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ doc_type: docType, content }),
      });
      const data = await res.json();
      if (data.document) {
        if (docType === "soul") setSoulVersion(data.document.version);
        if (docType === "agent_rules") setRulesVersion(data.document.version);
        if (docType === "user_profile") setProfileVersion(data.document.version);
        if (docType === "project_context") setProjectContextVersion(data.document.version);
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

  // --- Load memories ---

  const loadMemories = useCallback(async () => {
    if (!workspace?.id || !accountId) return;
    setLoadingMemories(true);
    try {
      const res = await fetch(
        `/api/agent/memories?account_id=${accountId}`,
        { headers: headers() }
      );
      const data = await res.json();
      setMemories(data.memories || []);
    } catch {
      setMemories([]);
    } finally {
      setLoadingMemories(false);
    }
  }, [workspace?.id, accountId, headers]);

  // --- Edit memory ---

  const saveMemoryEdit = async (memoryId: string) => {
    setMemoryMessage("");
    try {
      await fetch(`/api/agent/memories/${memoryId}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ value: editValue }),
      });
      setEditingMemory(null);
      loadMemories();
      setMemoryMessage("Memória atualizada!");
    } catch {
      setMemoryMessage("Erro ao atualizar.");
    }
    setTimeout(() => setMemoryMessage(""), 3000);
  };

  // --- Delete memory ---

  const deleteMemory = async (memoryId: string) => {
    try {
      await fetch(`/api/agent/memories?id=${memoryId}`, {
        method: "DELETE",
        headers: headers(),
      });
      loadMemories();
    } catch {
      setMemoryMessage("Erro ao deletar.");
    }
  };

  // --- Delete all memories ---

  const deleteAllMems = async () => {
    if (!accountId) return;
    if (!confirm("Tem certeza que deseja apagar TODAS as memórias desta conta?")) return;
    try {
      await fetch(`/api/agent/memories?account_id=${accountId}&all=true`, {
        method: "DELETE",
        headers: headers(),
      });
      loadMemories();
      setMemoryMessage("Todas as memórias foram apagadas.");
    } catch {
      setMemoryMessage("Erro ao apagar memórias.");
    }
    setTimeout(() => setMemoryMessage(""), 3000);
  };

  // --- Load conversations ---

  const loadConversations = useCallback(async () => {
    if (!workspace?.id || !accountId) return;
    setLoadingConversations(true);
    try {
      const res = await fetch(
        `/api/agent/conversations?account_id=${accountId}`,
        { headers: headers() }
      );
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch {
      setConversations([]);
    } finally {
      setLoadingConversations(false);
    }
  }, [workspace?.id, accountId, headers]);

  // --- Load conversation messages ---

  const toggleConversation = async (convId: string) => {
    if (expandedConv === convId) {
      setExpandedConv(null);
      return;
    }
    setExpandedConv(convId);
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/agent/conversations/${convId}`, { headers: headers() });
      const data = await res.json();
      setConvMessages(data.messages || []);
    } catch {
      setConvMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  };

  // Get account name for display
  const currentAccountName = accounts?.find(
    (a: { id: string }) => a.id === accountId
  )?.name || accountId || "Nenhuma conta";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/agent">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Configurações do Agente</h1>
          <p className="text-sm text-muted-foreground">
            Personalize a personalidade, regras e memória do Vortex
          </p>
        </div>
      </div>

      {/* Feedback */}
      {docMessage && (
        <div className={`rounded-lg px-4 py-2 text-sm ${
          docMessage.includes("Erro") ? "bg-red-500/10 text-red-500" : "bg-green-500/10 text-green-500"
        }`}>
          {docMessage}
        </div>
      )}

      <Tabs defaultValue="project" className="space-y-4">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="project" className="gap-1.5">
            <Building2 className="h-4 w-4" />
            <span className="hidden sm:inline">Projeto</span>
          </TabsTrigger>
          <TabsTrigger value="soul" className="gap-1.5">
            <Brain className="h-4 w-4" />
            <span className="hidden sm:inline">Personalidade</span>
          </TabsTrigger>
          <TabsTrigger value="rules" className="gap-1.5">
            <ScrollText className="h-4 w-4" />
            <span className="hidden sm:inline">Regras</span>
          </TabsTrigger>
          <TabsTrigger value="profile" className="gap-1.5">
            <UserCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Perfil</span>
          </TabsTrigger>
          <TabsTrigger value="memories" className="gap-1.5" onClick={loadMemories}>
            <Database className="h-4 w-4" />
            <span className="hidden sm:inline">Memórias</span>
          </TabsTrigger>
          <TabsTrigger value="conversations" className="gap-1.5" onClick={loadConversations}>
            <MessageSquare className="h-4 w-4" />
            <span className="hidden sm:inline">Conversas</span>
          </TabsTrigger>
        </TabsList>

        {/* ========== TAB: Projeto ========== */}
        <TabsContent value="project">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Contexto do Projeto</CardTitle>
                  <CardDescription>
                    Informacoes sobre sua empresa/projeto que todos os agentes usam como base para planejamentos e entregas.
                  </CardDescription>
                </div>
                {projectContextVersion > 0 && (
                  <Badge variant="outline">v{projectContextVersion}</Badge>
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
                    value={projectContext}
                    onChange={(e) => setProjectContext(e.target.value)}
                    className="w-full min-h-[400px] rounded-lg border border-border bg-background p-4 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                    placeholder={`Descreva sua empresa/projeto aqui. Exemplo:

# Minha Empresa

## O que fazemos
SaaS de gestao financeira para pequenas empresas.

## Publico-alvo
- Donos de pequenas empresas (faturamento R$50k-500k/mes)
- Contadores e gestores financeiros
- Idade: 28-50 anos

## Tom de voz
Profissional mas acessivel. Evitar jargoes tecnicos.
Usar "voce" em vez de "o usuario".

## Diferenciais
- Integracao automatica com bancos
- Dashboard intuitivo
- Suporte humanizado 24/7

## Concorrentes
- ContaAzul, Nibo, Omie

## Objetivos atuais
- Aumentar trial-to-paid de 8% para 15%
- Dobrar presenca em redes sociais
- Lancar feature de conciliacao bancaria`}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => saveDocument("project_context", projectContext)}
                      disabled={savingDoc === "project_context"}
                    >
                      {savingDoc === "project_context" ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Salvar
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (confirm("Limpar o contexto do projeto?")) {
                          setProjectContext("");
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Limpar
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== TAB: Soul ========== */}
        <TabsContent value="soul">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Personalidade (Soul)</CardTitle>
                  <CardDescription>
                    Define a identidade, tom e estilo de comunicação do Vortex. O agente também pode editar isso quando você pedir.
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
                    placeholder="Conteúdo da personalidade do agente em markdown..."
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
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (confirm("Restaurar a personalidade padrão? Suas edições serão perdidas.")) {
                          setSoul(DEFAULT_SOUL);
                        }
                      }}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Restaurar Padrão
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== TAB: Rules ========== */}
        <TabsContent value="rules">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Regras do Agente</CardTitle>
                  <CardDescription>
                    Regras de comportamento: wizard step-by-step, formato de choices, segurança, uso de memória e formatação.
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
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (confirm("Restaurar as regras padrão? Suas edições serão perdidas.")) {
                          setAgentRules(DEFAULT_AGENT_RULES);
                        }
                      }}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Restaurar Padrão
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== TAB: User Profile ========== */}
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Perfil do Usuário</CardTitle>
                  <CardDescription>
                    Gerado automaticamente pelo agente com base nas suas interações. Você pode editar ou complementar.
                  </CardDescription>
                </div>
                {profileVersion > 0 && (
                  <Badge variant="outline">v{profileVersion}</Badge>
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
                    value={userProfile}
                    onChange={(e) => setUserProfile(e.target.value)}
                    className="w-full min-h-[300px] rounded-lg border border-border bg-background p-4 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                    placeholder="Nenhum perfil gerado ainda. Converse com o Vortex para que ele aprenda sobre você, ou escreva manualmente aqui."
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => saveDocument("user_profile", userProfile)}
                      disabled={savingDoc === "user_profile"}
                    >
                      {savingDoc === "user_profile" ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Salvar
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (confirm("Limpar o perfil do usuário?")) {
                          setUserProfile("");
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Limpar
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== TAB: Memories ========== */}
        <TabsContent value="memories">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Memórias</CardTitle>
                  <CardDescription>
                    Fatos e preferências que o Vortex aprendeu sobre você na conta {currentAccountName}.
                  </CardDescription>
                </div>
                <Badge variant="outline">{memories.length} memórias</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {memoryMessage && (
                <div className={`rounded-lg px-3 py-2 text-sm ${
                  memoryMessage.includes("Erro") ? "bg-red-500/10 text-red-500" : "bg-green-500/10 text-green-500"
                }`}>
                  {memoryMessage}
                </div>
              )}

              {loadingMemories ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : memories.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Nenhuma memória salva ainda.</p>
                  <p className="text-xs mt-1">Converse com o Vortex para que ele aprenda suas preferências.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {memories.map((mem) => (
                    <div
                      key={mem.id}
                      className="flex items-start gap-3 rounded-lg border border-border p-3 hover:bg-accent/50 transition-colors"
                    >
                      <Badge
                        variant="outline"
                        className={`shrink-0 mt-0.5 ${CATEGORY_COLORS[mem.category] || CATEGORY_COLORS.general}`}
                      >
                        {mem.category}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{mem.key}</p>
                        {editingMemory === mem.id ? (
                          <div className="flex items-center gap-2 mt-1">
                            <Input
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="text-sm"
                              autoFocus
                            />
                            <Button size="sm" onClick={() => saveMemoryEdit(mem.id)}>
                              <Save className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingMemory(null)}
                            >
                              Cancelar
                            </Button>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">{mem.value}</p>
                        )}
                      </div>
                      {editingMemory !== mem.id && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => {
                              setEditingMemory(mem.id);
                              setEditValue(mem.value);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-red-500 hover:text-red-600"
                            onClick={() => {
                              if (confirm(`Deletar memória "${mem.key}"?`)) {
                                deleteMemory(mem.id);
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {memories.length > 0 && (
                <Button variant="outline" className="text-red-500" onClick={deleteAllMems}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Limpar Todas as Memórias
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== TAB: Conversations ========== */}
        <TabsContent value="conversations">
          <Card>
            <CardHeader>
              <CardTitle>Histórico de Conversas</CardTitle>
              <CardDescription>
                Conversas anteriores com o Vortex na conta {currentAccountName}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingConversations ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Nenhuma conversa encontrada.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {conversations.map((conv) => (
                    <div key={conv.id}>
                      <button
                        onClick={() => toggleConversation(conv.id)}
                        className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-accent/50 transition-colors text-left"
                      >
                        {expandedConv === conv.id ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {conv.title || "Conversa sem título"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(conv.created_at).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </button>

                      {expandedConv === conv.id && (
                        <div className="ml-7 mb-3 space-y-2 border-l-2 border-border pl-4">
                          {loadingMessages ? (
                            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Carregando mensagens...
                            </div>
                          ) : convMessages.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-2">
                              Nenhuma mensagem encontrada.
                            </p>
                          ) : (
                            convMessages.map((msg) => (
                              <div
                                key={msg.id}
                                className={`rounded-lg px-3 py-2 text-sm ${
                                  msg.role === "user"
                                    ? "bg-primary/10 text-foreground"
                                    : "bg-muted"
                                }`}
                              >
                                <Label className="text-xs font-semibold uppercase tracking-wide">
                                  {msg.role === "user" ? "Você" : "Vortex"}
                                </Label>
                                <p className="mt-1 whitespace-pre-wrap leading-relaxed">
                                  {msg.content}
                                </p>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
