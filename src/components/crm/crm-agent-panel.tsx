"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Filter, Zap, Bot, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useAccount } from "@/lib/account-context";
import { useWorkspace } from "@/lib/workspace-context";
import { MessageContent } from "@/components/ui/message-content";
import { cn } from "@/lib/utils";
import type {
  RfmSegment, DayRange, LifecycleStage, HourPref,
  CouponSensitivity, Weekday,
} from "@/lib/crm-rfm";

// --- Types ---

interface SuggestionData {
  name: string;
  description: string;
  reasoning: string;
  filters: {
    segmentFilter?: RfmSegment | "all";
    lifecycleFilter?: LifecycleStage | "all";
    couponFilter?: CouponSensitivity | "all";
    hourFilter?: HourPref | "all";
    weekdayFilter?: Weekday | "all";
    dayRangeFilter?: DayRange | "all";
  };
  estimatedCount: number;
  channels: string[];
  timing: string;
  urgency: "alta" | "media" | "baixa";
  campaignType: string;
}

export interface CrmFilters {
  segmentFilter: RfmSegment | "all";
  dayRangeFilter: DayRange | "all";
  lifecycleFilter: LifecycleStage | "all";
  hourFilter: HourPref | "all";
  couponFilter: CouponSensitivity | "all";
  weekdayFilter: Weekday | "all";
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  suggestions: SuggestionData[];
  toolCalls?: Array<{ name: string; status: "running" | "done" | "error" }>;
  specialistResponses?: Array<{
    agent_name: string;
    agent_color: string;
    agent_slug: string;
    content: string;
    model: string;
    status: "working" | "done";
  }>;
}

interface CrmAgentPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplyFilters: (filters: CrmFilters) => void;
}

// --- Tool labels ---

const TOOL_LABELS: Record<string, string> = {
  get_crm_overview: "Analisando dados do CRM",
  get_export_history: "Verificando exportacoes recentes",
  get_cohort_trends: "Analisando tendencias mensais",
  get_financial_context: "Buscando dados financeiros",
  delegate_to_agent: "Acionando especialista",
  save_deliverable: "Salvando entrega",
  create_task: "Criando tarefa",
  create_project: "Criando projeto",
};

// --- Suggestion extraction ---

function extractSuggestions(text: string): { cleanText: string; suggestions: SuggestionData[] } {
  const suggestions: SuggestionData[] = [];
  const regex = /<suggestion>([\s\S]*?)<\/suggestion>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      suggestions.push(JSON.parse(match[1]));
    } catch { /* skip malformed */ }
  }
  const cleanText = text.replace(/<suggestion>[\s\S]*?<\/suggestion>/g, "").trim();
  return { cleanText, suggestions };
}

// --- Suggestion Card ---

function SuggestionCard({
  suggestion,
  onApplyFilters,
  onGenerateCampaign,
}: {
  suggestion: SuggestionData;
  onApplyFilters: (filters: CrmFilters) => void;
  onGenerateCampaign: (suggestion: SuggestionData) => void;
}) {
  const urgencyColors = {
    alta: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30" },
    media: { bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/30" },
    baixa: { bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/30" },
  };
  const colors = urgencyColors[suggestion.urgency] || urgencyColors.media;

  const channelLabels: Record<string, string> = {
    email: "Email",
    whatsapp: "WhatsApp",
    sms: "SMS",
    push: "Push",
    ads: "Ads",
  };

  return (
    <div className={`rounded-lg border ${colors.border} ${colors.bg} p-4 my-3`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="font-semibold text-sm text-foreground">{suggestion.name}</h4>
        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded shrink-0 ${colors.text} ${colors.bg} border ${colors.border}`}>
          {suggestion.urgency}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-2">{suggestion.description}</p>
      <p className="text-xs text-foreground/70 mb-3">{suggestion.reasoning}</p>
      <div className="flex flex-wrap gap-1.5 text-[11px] mb-3">
        <span className="bg-card border border-border px-2 py-0.5 rounded">~{suggestion.estimatedCount} clientes</span>
        {suggestion.channels.map((ch) => (
          <span key={ch} className="bg-card border border-border px-2 py-0.5 rounded">
            {channelLabels[ch] || ch}
          </span>
        ))}
        {suggestion.timing && (
          <span className="bg-card border border-border px-2 py-0.5 rounded">{suggestion.timing}</span>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="text-xs gap-1 h-7"
          onClick={() => {
            onApplyFilters({
              segmentFilter: suggestion.filters.segmentFilter || "all",
              dayRangeFilter: suggestion.filters.dayRangeFilter || "all",
              lifecycleFilter: suggestion.filters.lifecycleFilter || "all",
              hourFilter: suggestion.filters.hourFilter || "all",
              couponFilter: suggestion.filters.couponFilter || "all",
              weekdayFilter: suggestion.filters.weekdayFilter || "all",
            });
          }}
        >
          <Filter className="h-3 w-3" /> Aplicar Filtros
        </Button>
        <Button
          size="sm"
          className="text-xs gap-1 h-7"
          onClick={() => onGenerateCampaign(suggestion)}
        >
          <Zap className="h-3 w-3" /> Gerar Campanha
        </Button>
      </div>
    </div>
  );
}

// --- Specialist Response Card ---

function SpecialistCard({ response }: { response: NonNullable<ChatMessage["specialistResponses"]>[number] }) {
  const [expanded, setExpanded] = useState(false);
  const isWorking = response.status === "working";

  return (
    <div
      className="rounded-lg border border-border/50 my-2 overflow-hidden"
      style={{ borderLeftColor: response.agent_color, borderLeftWidth: 3 }}
    >
      <button
        onClick={() => !isWorking && setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-accent/30 transition-colors"
      >
        <div className="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: response.agent_color }}>
          {response.agent_name.charAt(0).toUpperCase()}
        </div>
        <span className="text-xs font-medium text-foreground">{response.agent_name}</span>
        {isWorking ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
        ) : (
          <>
            <Check className="h-3 w-3 text-green-500 ml-auto" />
            <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", expanded && "rotate-180")} />
          </>
        )}
      </button>
      {expanded && response.content && (
        <div className="px-3 pb-3 border-t border-border/30">
          <MessageContent content={response.content} className="text-xs mt-2" />
        </div>
      )}
    </div>
  );
}

// --- Main Component ---

export function CrmAgentPanel({ open, onOpenChange, onApplyFilters }: CrmAgentPanelProps) {
  const { workspace } = useWorkspace();
  const { accountId, accounts } = useAccount();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [autoPromptSent, setAutoPromptSent] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Resolve the crm-specialist agent ID on mount
  useEffect(() => {
    if (!workspace?.id) return;
    fetch(`/api/team/agents?slim=true`, {
      headers: { "x-workspace-id": workspace.id },
    })
      .then((r) => r.json())
      .then((data) => {
        const crmAgent = (data.agents || []).find(
          (a: { slug: string; id: string }) => a.slug === "crm-specialist"
        );
        if (crmAgent) setAgentId(crmAgent.id);
      })
      .catch(() => {});
  }, [workspace?.id]);

  // Auto-prompt on first open
  useEffect(() => {
    if (open && agentId && !autoPromptSent && messages.length === 0) {
      setAutoPromptSent(true);
      sendMessage(
        "Analise meus dados de CRM e sugira hipersegmentacoes com alta chance de conversao real em curto prazo. Verifique as exportacoes recentes para evitar fadiga de contato."
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agentId, autoPromptSent]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !agentId || isLoading) return;

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: text.trim(),
        suggestions: [],
      };
      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: "",
        suggestions: [],
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");
      setIsLoading(true);

      try {
        // Build history for context
        const history = messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        const selectedAccountId = accountId && accountId !== "all" ? accountId : "";
        const account = (accounts as Array<{ id: string; name?: string; currency?: string; timezone_name?: string }>)
          ?.find((a) => a.id === selectedAccountId);

        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-workspace-id": workspace?.id || "",
          },
          body: JSON.stringify({
            message: text.trim(),
            history,
            accountId: selectedAccountId || workspace?.id || "crm",
            accountContext: {
              account_name: account?.name || workspace?.name || "CRM",
              account_id: selectedAccountId || workspace?.id || "crm",
              currency: account?.currency || "BRL",
              timezone: account?.timezone_name || "America/Sao_Paulo",
            },
            conversationId,
            agentId,
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
                      // Re-extract suggestions from accumulated text
                      const { cleanText, suggestions } = extractSuggestions(last.content);
                      last.suggestions = suggestions;
                      // Keep raw content for streaming; cleanText used in render
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
                        (t) => t.name === event.name && t.status === "running"
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
                        (s) => s.agent_slug === event.agent_slug && s.status === "working"
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

                case "task_queued":
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last.role === "assistant") {
                      last.specialistResponses = [
                        ...(last.specialistResponses || []),
                        {
                          agent_name: event.agent_name,
                          agent_color: "#F59E0B",
                          agent_slug: event.agent_slug,
                          content: `Tarefa criada: ${event.task_title}`,
                          model: "",
                          status: "done",
                        },
                      ];
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
                      last.content += `\n\n**Erro:** ${event.message}`;
                    }
                    return updated;
                  });
                  break;

                case "done":
                  break;
              }
            } catch {
              // skip malformed SSE lines
            }
          }
        }
      } catch (err) {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === "assistant") {
            last.content = `Erro ao conectar com o agente: ${err instanceof Error ? err.message : "erro desconhecido"}`;
          }
          return updated;
        });
      } finally {
        setIsLoading(false);
      }
    },
    [agentId, isLoading, messages, workspace?.id, workspace?.name, accountId, accounts, conversationId]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleGenerateCampaign = (suggestion: SuggestionData) => {
    sendMessage(
      `Gere uma campanha completa para o segmento "${suggestion.name}": delegue ao copywriter para criar copy de email e WhatsApp, e ao especialista de email-sequence para montar a sequencia de emails. Contexto do segmento: ${JSON.stringify({ name: suggestion.name, description: suggestion.description, filters: suggestion.filters, estimatedCount: suggestion.estimatedCount, channels: suggestion.channels, campaignType: suggestion.campaignType })}`
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-xl w-full p-0 flex flex-col">
        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-sky-500 flex items-center justify-center text-white shrink-0">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <SheetTitle className="text-base">Ana — CRM Intelligence</SheetTitle>
              <SheetDescription className="text-xs">
                Hipersegmentacao e campanhas de alta conversao
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 opacity-60">
              <Bot className="h-10 w-10 text-sky-500" />
              <p className="text-sm text-muted-foreground max-w-xs">
                Clique para analisar seus dados de CRM e receber sugestoes de hipersegmentacao personalizadas.
              </p>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-2 max-w-[85%]">
                    <MessageContent content={msg.content} className="text-sm" isUser />
                  </div>
                </div>
              );
            }

            // Assistant message
            const { cleanText, suggestions } = extractSuggestions(msg.content);
            const displaySuggestions = suggestions.length > 0 ? suggestions : msg.suggestions;

            return (
              <div key={msg.id} className="space-y-1">
                {/* Tool calls */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="space-y-1 mb-2">
                    {msg.toolCalls.map((tc, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                        {tc.status === "running" ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3 text-green-500" />
                        )}
                        <span>{TOOL_LABELS[tc.name] || tc.name}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Text content */}
                {cleanText && (
                  <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3 max-w-[95%]">
                    <MessageContent content={cleanText} className="text-sm" />
                  </div>
                )}

                {/* Suggestion cards */}
                {displaySuggestions.length > 0 && (
                  <div className="max-w-[95%]">
                    {displaySuggestions.map((s, i) => (
                      <SuggestionCard
                        key={i}
                        suggestion={s}
                        onApplyFilters={onApplyFilters}
                        onGenerateCampaign={handleGenerateCampaign}
                      />
                    ))}
                  </div>
                )}

                {/* Specialist responses */}
                {msg.specialistResponses && msg.specialistResponses.length > 0 && (
                  <div className="max-w-[95%]">
                    {msg.specialistResponses.map((sr, i) => (
                      <SpecialistCard key={i} response={sr} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="shrink-0 border-t border-border p-3 flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte sobre segmentacoes, campanhas..."
            className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 min-h-[40px] max-h-[120px]"
            rows={1}
            disabled={isLoading || !agentId}
          />
          <Button
            type="submit"
            size="icon"
            disabled={isLoading || !input.trim() || !agentId}
            className="h-10 w-10 shrink-0"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
