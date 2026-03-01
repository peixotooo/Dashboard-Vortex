"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Send,
  Loader2,
  User,
  Wrench,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAccount } from "@/lib/account-context";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

interface AgentInfo {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatar_color: string;
  is_default: boolean;
}

interface SpecialistResponse {
  agent_name: string;
  agent_color: string;
  agent_slug: string;
  content: string;
  model: string;
  status: "working" | "done";
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{ name: string; status: "running" | "done" | "error" }>;
  choices?: Array<{ label: string; value: string }>;
  specialistResponses?: SpecialistResponse[];
}

const TOOL_LABELS: Record<string, string> = {
  delegate_to_agent: "Acionando Especialista",
  create_task: "Criando Tarefa",
  update_task: "Atualizando Tarefa",
  save_deliverable: "Salvando Entrega",
  save_memory: "Salvando Memória",
  recall_memory: "Consultando Memória",
  get_account_overview: "Resumo da Conta",
  list_campaigns: "Listando Campanhas",
  get_campaign_metrics: "Buscando Métricas",
  create_campaign: "Criando Campanha",
  update_campaign: "Atualizando Campanha",
  pause_campaign: "Pausando Campanha",
  resume_campaign: "Reativando Campanha",
  create_adset: "Criando Ad Set",
  analyze_performance: "Analisando Performance",
  list_custom_audiences: "Listando Audiências",
};

const MODEL_LABELS: Record<string, string> = {
  "claude-opus-4-6": "Opus",
  "claude-sonnet-4-5-20250929": "Sonnet",
  "claude-haiku-4-5-20251001": "Haiku",
};

export default function TeamChatPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { accountId, accounts } = useAccount();
  const { workspace } = useWorkspace();

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [loadingAgents, setLoadingAgents] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load agents
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
        setLoadingAgents(false);
      }
    }

    loadAgents();
  }, [workspace?.id]);

  // Select agent from URL param
  useEffect(() => {
    const agentSlug = searchParams.get("agent");
    if (agentSlug && agents.length > 0) {
      const agent = agents.find((a) => a.slug === agentSlug);
      if (agent && agent.id !== selectedAgent?.id) {
        setSelectedAgent(agent);
        setMessages([]);
        setConversationId(undefined);
      }
    } else if (!agentSlug && agents.length > 0 && !selectedAgent) {
      // Default to coordinator
      const coord = agents.find((a) => a.slug === "coordenador") || agents[0];
      setSelectedAgent(coord);
      router.replace(`/team/chat?agent=${coord.slug}`);
    }
  }, [agents, searchParams]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSelectAgent = (agent: AgentInfo) => {
    if (agent.id === selectedAgent?.id) return;
    setSelectedAgent(agent);
    setMessages([]);
    setConversationId(undefined);
    router.replace(`/team/chat?agent=${agent.slug}`);
  };

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !accountId || !selectedAgent || isLoading) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text.trim(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsLoading(true);

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: "",
        toolCalls: [],
        specialistResponses: [],
      };
      setMessages((prev) => [...prev, assistantMsg]);

      try {
        const history = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-workspace-id": workspace?.id || "",
          },
          body: JSON.stringify({
            message: text.trim(),
            history,
            accountId,
            accountContext: {
              account_name: (accounts as Array<{ id: string; name?: string; currency?: string; timezone_name?: string }>)?.find((a) => a.id === accountId)?.name || "Conta Meta",
              account_id: accountId,
              currency: (accounts as Array<{ id: string; currency?: string }>)?.find((a) => a.id === accountId)?.currency || "BRL",
              timezone: (accounts as Array<{ id: string; timezone_name?: string }>)?.find((a) => a.id === accountId)?.timezone_name || "America/Sao_Paulo",
            },
            conversationId,
            agentId: selectedAgent.id,
          }),
        });

        if (!res.ok || !res.body) throw new Error("Failed to connect");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));

              switch (event.type) {
                case "text":
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last.role === "assistant") {
                      last.content += event.content;
                    }
                    return updated;
                  });
                  break;

                case "tool_use":
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last.role === "assistant") {
                      last.toolCalls = [
                        ...(last.toolCalls || []),
                        { name: event.name, status: "running" },
                      ];
                    }
                    return updated;
                  });
                  break;

                case "tool_result":
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last.role === "assistant" && last.toolCalls) {
                      const tc = last.toolCalls.find(
                        (t) =>
                          t.name === event.name && t.status === "running"
                      );
                      if (tc) tc.status = "done";
                    }
                    return updated;
                  });
                  break;

                case "specialist_start":
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last.role === "assistant") {
                      last.specialistResponses = [
                        ...(last.specialistResponses || []),
                        {
                          agent_name: event.agent_slug,
                          agent_color: "#6B7280",
                          agent_slug: event.agent_slug,
                          content: "",
                          model: "",
                          status: "working",
                        },
                      ];
                    }
                    return updated;
                  });
                  break;

                case "specialist_response":
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last.role === "assistant" && last.specialistResponses) {
                      const sr = last.specialistResponses.find(
                        (s) =>
                          s.agent_slug === event.agent_slug &&
                          s.status === "working"
                      );
                      if (sr) {
                        sr.agent_name = event.agent_name;
                        sr.agent_color = event.agent_color;
                        sr.content = event.content;
                        sr.model = event.model;
                        sr.status = "done";
                      }
                    }
                    return updated;
                  });
                  break;

                case "choices":
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last.role === "assistant") {
                      last.choices = event.choices;
                    }
                    return updated;
                  });
                  break;

                case "conversation_id":
                  setConversationId(event.conversationId);
                  break;

                case "error":
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last.role === "assistant") {
                      last.content += `\n\nErro: ${event.message}`;
                    }
                    return updated;
                  });
                  break;
              }
            } catch {
              // Skip malformed events
            }
          }
        }
      } catch {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === "assistant") {
            last.content = "Erro ao conectar com o agente. Tente novamente.";
          }
          return updated;
        });
      } finally {
        setIsLoading(false);
      }
    },
    [accountId, workspace?.id, selectedAgent, isLoading, messages, conversationId]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleChoiceClick = (value: string) => {
    sendMessage(value);
  };

  if (loadingAgents) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-0">
      {/* Agent sidebar */}
      <div className="w-64 border-r border-border bg-card/50 overflow-y-auto shrink-0">
        <div className="p-3">
          <h3 className="text-sm font-semibold text-muted-foreground px-2 mb-2">
            Agentes
          </h3>
          <div className="space-y-1">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => handleSelectAgent(agent)}
                className={cn(
                  "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors text-left cursor-pointer",
                  selectedAgent?.id === agent.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white text-sm font-bold shrink-0"
                  style={{ backgroundColor: agent.avatar_color }}
                >
                  {agent.name[0]}
                </div>
                <div className="min-w-0">
                  <div className="font-medium truncate">{agent.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {agent.description.split("—")[0].trim()}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        {selectedAgent && (
          <div className="flex items-center gap-3 border-b border-border px-6 py-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full text-white font-bold shrink-0"
              style={{ backgroundColor: selectedAgent.avatar_color }}
            >
              {selectedAgent.name[0]}
            </div>
            <div>
              <h2 className="font-semibold">{selectedAgent.name}</h2>
              <p className="text-xs text-muted-foreground">
                {selectedAgent.description}
              </p>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 && selectedAgent && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div
                className="flex h-16 w-16 items-center justify-center rounded-full text-white text-2xl font-bold mb-4"
                style={{ backgroundColor: selectedAgent.avatar_color }}
              >
                {selectedAgent.name[0]}
              </div>
              <h3 className="text-lg font-semibold">
                Oi! Eu sou {selectedAgent.name === "Marcos" ? "o" : ""}{" "}
                {selectedAgent.name}
              </h3>
              <p className="text-muted-foreground mt-1 max-w-md">
                {selectedAgent.description}. Como posso te ajudar?
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-3",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {msg.role === "assistant" && selectedAgent && (
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white text-sm font-bold shrink-0 mt-1"
                  style={{ backgroundColor: selectedAgent.avatar_color }}
                >
                  {selectedAgent.name[0]}
                </div>
              )}

              <div
                className={cn(
                  "max-w-[75%] rounded-2xl px-4 py-3 text-sm",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-muted rounded-bl-md"
                )}
              >
                {/* Tool calls */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="space-y-1 mb-2">
                    {msg.toolCalls.map((tc, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-xs opacity-70"
                      >
                        {tc.status === "running" ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : tc.status === "error" ? (
                          <AlertCircle className="h-3 w-3" />
                        ) : (
                          <Wrench className="h-3 w-3" />
                        )}
                        <span>
                          {TOOL_LABELS[tc.name] || tc.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Specialist responses */}
                {msg.specialistResponses && msg.specialistResponses.length > 0 && (
                  <div className="space-y-3 mb-3">
                    {msg.specialistResponses.map((sr, i) => (
                      <div
                        key={i}
                        className="border rounded-lg overflow-hidden"
                        style={{ borderColor: sr.agent_color + "40" }}
                      >
                        {/* Specialist header */}
                        <div
                          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium"
                          style={{
                            backgroundColor: sr.agent_color + "15",
                            color: sr.agent_color,
                          }}
                        >
                          <div
                            className="flex h-5 w-5 items-center justify-center rounded-full text-white text-[10px] font-bold shrink-0"
                            style={{ backgroundColor: sr.agent_color }}
                          >
                            {sr.agent_name[0]}
                          </div>
                          <span>{sr.agent_name}</span>
                          {sr.status === "working" && (
                            <Loader2 className="h-3 w-3 animate-spin ml-auto" />
                          )}
                          {sr.status === "done" && sr.model && (
                            <span className="ml-auto opacity-60 text-[10px]">
                              {MODEL_LABELS[sr.model] || sr.model}
                            </span>
                          )}
                        </div>
                        {/* Specialist content */}
                        {sr.status === "working" && !sr.content && (
                          <div className="px-3 py-2 text-xs text-muted-foreground">
                            Trabalhando...
                          </div>
                        )}
                        {sr.content && (
                          <div className="px-3 py-2 text-xs whitespace-pre-wrap bg-background/50">
                            {sr.content}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Text */}
                {msg.content && (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                )}

                {/* Choices */}
                {msg.choices && msg.choices.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {msg.choices.map((choice, i) => (
                      <Button
                        key={i}
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => handleChoiceClick(choice.value)}
                        disabled={isLoading}
                      >
                        {choice.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              {msg.role === "user" && (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-primary shrink-0 mt-1">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          ))}

          {isLoading && messages[messages.length - 1]?.content === "" && !messages[messages.length - 1]?.specialistResponses?.length && (
            <div className="flex gap-3">
              {selectedAgent && (
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white text-sm font-bold shrink-0"
                  style={{ backgroundColor: selectedAgent.avatar_color }}
                >
                  {selectedAgent.name[0]}
                </div>
              )}
              <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border p-4">
          <div className="flex gap-2 items-end max-w-4xl mx-auto">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                selectedAgent
                  ? `Fale com ${selectedAgent.name}...`
                  : "Selecione um agente..."
              }
              className="min-h-[44px] max-h-[120px] resize-none"
              disabled={isLoading || !selectedAgent}
              rows={1}
            />
            <Button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isLoading || !selectedAgent}
              size="icon"
              className="shrink-0"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
