"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Loader2,
  Bot,
  User,
  Wrench,
  AlertCircle,
  Zap,
  Brain,
  Settings,
  ImagePlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAccount } from "@/lib/account-context";
import { useWorkspace } from "@/lib/workspace-context";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{ name: string; status: "running" | "done" | "error" }>;
  model?: string;
  choices?: Array<{ label: string; value: string }>;
}

const TOOL_LABELS: Record<string, string> = {
  get_account_overview: "Resumo da Conta",
  list_campaigns: "Listar Campanhas",
  get_campaign_metrics: "Métricas",
  create_campaign: "Criar Campanha",
  update_campaign: "Atualizar Campanha",
  pause_campaign: "Pausar Campanha",
  resume_campaign: "Reativar Campanha",
  create_adset: "Criar Ad Set",
  create_ad_creative: "Criando Criativo",
  create_ad: "Criando Anúncio",
  analyze_performance: "Analisar Performance",
  list_custom_audiences: "Listar Audiências",
  save_memory: "Salvando Memória",
  recall_memory: "Consultando Memória",
  update_personality: "Atualizando Personalidade",
};

export default function AgentPage() {
  const { accountId, accounts } = useAccount();
  const { workspace } = useWorkspace();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentAccount = accounts.find(
    (a: { id: string }) => a.id === accountId
  );

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading || !accountId) return;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setIsLoading(true);

      // Build history for the API (last 20 messages)
      const currentMessages = messages;
      const history = [...currentMessages, userMessage]
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }));

      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", toolCalls: [] },
      ]);

      try {
        // Upload attached images to Meta and read as base64 for Claude vision
        let attachments: Array<{ filename: string; image_hash: string; image_data?: string; media_type?: string }> = [];
        if (attachedFiles.length > 0) {
          const uploadPromises = attachedFiles.map(async (file) => {
            // Upload to Meta API
            const formData = new FormData();
            formData.append("filename", file, file.name);
            formData.append("account_id", accountId);
            const uploadRes = await fetch("/api/media", { method: "POST", body: formData });
            const data = await uploadRes.json();
            const images = data.images || {};
            const firstKey = Object.keys(images)[0];
            const imageHash = firstKey ? images[firstKey].hash : null;

            // Read as base64 for Claude vision
            let imageData: string | undefined;
            const mediaType = file.type || "image/jpeg";
            try {
              const buffer = await file.arrayBuffer();
              imageData = btoa(String.fromCharCode(...new Uint8Array(buffer)));
            } catch {
              // Continue without base64 if file is too large
            }

            return { filename: file.name, image_hash: imageHash, image_data: imageData, media_type: mediaType };
          });
          attachments = (await Promise.all(uploadPromises)).filter(
            (a) => !!a.image_hash
          ) as Array<{ filename: string; image_hash: string; image_data?: string; media_type?: string }>;
          setAttachedFiles([]);
        }

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (workspace?.id) {
          headers["x-workspace-id"] = workspace.id;
        }

        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers,
          body: JSON.stringify({
            message: trimmed,
            history: history.slice(0, -1),
            accountId,
            accountContext: {
              account_name: currentAccount?.name || "Conta Meta",
              account_id: accountId,
              currency: "BRL",
              timezone: "America/Sao_Paulo",
            },
            conversationId,
            attachments: attachments.length > 0 ? attachments : undefined,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Erro na requisição");
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("Stream não disponível");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE lines
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6);

            try {
              const event = JSON.parse(jsonStr);

              if (event.type === "text") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: m.content + event.content }
                      : m
                  )
                );
              } else if (event.type === "tool_use") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          toolCalls: [
                            ...(m.toolCalls || []),
                            {
                              name: event.name,
                              status: "running" as const,
                            },
                          ],
                        }
                      : m
                  )
                );
              } else if (event.type === "tool_result") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          toolCalls: (m.toolCalls || []).map((tc) =>
                            tc.name === event.name
                              ? { ...tc, status: "done" as const }
                              : tc
                          ),
                        }
                      : m
                  )
                );
              } else if (event.type === "model") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, model: event.model } : m
                  )
                );
              } else if (event.type === "choices") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, choices: event.choices }
                      : m
                  )
                );
              } else if (event.type === "conversation_id") {
                setConversationId(event.conversationId);
              } else if (event.type === "error") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          content:
                            m.content || `Erro: ${event.message}`,
                        }
                      : m
                  )
                );
              }
            } catch {
              // Ignore malformed JSON
            }
          }
        }
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    err instanceof Error
                      ? err.message
                      : "Erro ao conectar com o agente.",
                }
              : m
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, accountId, messages, workspace?.id, currentAccount?.name, conversationId, attachedFiles]
  );

  const handleSubmit = useCallback(() => {
    sendMessage(input);
  }, [input, sendMessage]);

  const handleChoiceClick = useCallback(
    (choice: { label: string; value: string }, messageId: string) => {
      // Remove choices from the message (mark as selected)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, choices: undefined } : m
        )
      );

      // Send the label as a user message
      sendMessage(choice.label);
    },
    [sendMessage]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-border mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Zap className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-bold">Vortex</h1>
          <p className="text-xs text-muted-foreground">
            Seu assistente inteligente de Meta Ads
            {currentAccount && (
              <span> &middot; {currentAccount.name}</span>
            )}
          </p>
        </div>
        <Link href="/agent/settings">
          <Button variant="ghost" size="icon" title="Configurações do Agente">
            <Settings className="h-5 w-5" />
          </Button>
        </Link>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4 pr-2">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground space-y-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Zap className="h-8 w-8 text-primary" />
            </div>
            <div>
              <p className="text-base font-medium text-foreground">
                Oi! Eu sou o Vortex.
              </p>
              <p className="text-sm mt-1">
                Como posso ajudar com suas campanhas hoje?
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4 w-full max-w-lg">
              {[
                "Quais campanhas estão ativas?",
                "Como está a performance essa semana?",
                "Quero criar uma nova campanha",
                "Analisa minha campanha principal",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                    textareaRef.current?.focus();
                  }}
                  className="text-left text-xs p-3 rounded-lg border border-border hover:bg-accent transition-colors cursor-pointer"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            {msg.role === "assistant" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-1">
                <Bot className="h-4 w-4 text-primary" />
              </div>
            )}

            <div
              className={`max-w-[80%] space-y-2 ${
                msg.role === "user" ? "order-first" : ""
              }`}
            >
              {/* Tool calls badges */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {msg.toolCalls.map((tc, i) => (
                    <Badge
                      key={i}
                      variant={tc.status === "done" ? "default" : "secondary"}
                      className="text-xs gap-1"
                    >
                      {tc.status === "running" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : tc.status === "error" ? (
                        <AlertCircle className="h-3 w-3" />
                      ) : tc.name === "save_memory" ||
                        tc.name === "recall_memory" ? (
                        <Brain className="h-3 w-3" />
                      ) : (
                        <Wrench className="h-3 w-3" />
                      )}
                      {TOOL_LABELS[tc.name] || tc.name}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Message content */}
              <Card
                className={`p-3 ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card"
                }`}
              >
                {msg.content ? (
                  <div className="text-sm whitespace-pre-wrap leading-relaxed">
                    {msg.content}
                  </div>
                ) : msg.role === "assistant" && isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Pensando...
                  </div>
                ) : null}
              </Card>

              {/* Choice buttons */}
              {msg.choices && msg.choices.length > 0 && !isLoading && (
                <div className="flex flex-wrap gap-2">
                  {msg.choices.map((choice) => (
                    <Button
                      key={choice.value}
                      variant="outline"
                      size="sm"
                      className="text-xs cursor-pointer"
                      onClick={() => handleChoiceClick(choice, msg.id)}
                    >
                      {choice.label}
                    </Button>
                  ))}
                </div>
              )}

              {/* Model indicator */}
              {msg.model && msg.role === "assistant" && (
                <p className="text-[10px] text-muted-foreground/50">
                  {msg.model.includes("haiku") ? "Haiku" : "Sonnet"}
                </p>
              )}
            </div>

            {msg.role === "user" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted mt-1">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border pt-4">
        {attachedFiles.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {attachedFiles.map((file, i) => (
              <div key={i} className="relative group">
                <img
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  className="h-16 w-16 rounded-lg object-cover border border-border"
                />
                <button
                  onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              setAttachedFiles((prev) => [...prev, ...files]);
              e.target.value = "";
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || !accountId}
            title="Anexar criativos"
          >
            <ImagePlus className="h-4 w-4" />
          </Button>
          <Textarea
            ref={textareaRef}
            placeholder={
              accountId
                ? "Pergunte algo sobre suas campanhas..."
                : "Selecione uma conta de anúncios primeiro"
            }
            className="resize-none min-h-[44px] max-h-32"
            rows={1}
            value={input}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setInput(e.target.value)
            }
            onKeyDown={handleKeyDown}
            disabled={isLoading || !accountId}
          />
          <Button
            onClick={handleSubmit}
            disabled={isLoading || !input.trim() || !accountId}
            size="icon"
            className="h-11 w-11 shrink-0"
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
  );
}
