"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Send,
  Loader2,
  User,
  Wrench,
  AlertCircle,
  ImagePlus,
  FolderOpen,
  X,
  Check,
  Plus,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAccount } from "@/lib/account-context";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import { MessageContent } from "@/components/ui/message-content";
import { GalleryPicker, type MediaItem } from "@/components/gallery-picker";
import { createClient } from "@/lib/supabase";

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
  create_ad_creative: "Criando Criativo",
  create_ad: "Criando Anúncio",
  upload_image_from_url: "Enviando Imagem",
  analyze_performance: "Analisando Performance",
  list_custom_audiences: "Listando Audiências",
  list_media_gallery: "Consultando Galeria",
  get_crm_overview: "Analisando CRM",
  get_export_history: "Verificando Exportacoes",
  get_cohort_trends: "Analisando Coortes",
  get_financial_context: "Buscando Dados Financeiros",
};

const MODEL_LABELS: Record<string, string> = {
  "claude-opus-4-6": "Opus",
  "claude-sonnet-4-5-20250929": "Sonnet",
  "claude-haiku-4-5-20251001": "Haiku",
};

function formatRelativeDate(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export default function TeamChatPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { accountId, accounts } = useAccount();
  const { workspace } = useWorkspace();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [conversations, setConversations] = useState<Array<{ id: string; title: string | null; updated_at: string }>>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);

  // Sync selectedAccountId with global accountId
  useEffect(() => {
    if (accountId && accountId !== "all") {
      setSelectedAccountId(accountId);
    } else if (accounts.length > 0) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accountId, accounts]);

  const [galleryOpen, setGalleryOpen] = useState(false);

  const [attachments, setAttachments] = useState<Array<{
    id: string;
    file: File;
    preview: string;
    status: "uploading" | "done" | "error";
    image_hash?: string;
    video_id?: string;
    image_url?: string;
  }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isUploading = attachments.some((a) => a.status === "uploading");

  const uploadFile = useCallback(async (id: string, file: File) => {
    try {
      const uploadAccId = selectedAccountId || accountId;
      if (!uploadAccId || uploadAccId === "all") throw new Error("Selecione uma conta");

      const headers: Record<string, string> = {};
      if (workspace?.id) headers["x-workspace-id"] = workspace.id;

      const isVideo = file.type.startsWith("video/");
      let data: any;

      if (isVideo) {
        // Videos: upload directly to Supabase via signed URL, then register
        const urlRes = await fetch("/api/media/upload-url", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, mime_type: file.type }),
        });
        const urlData = await urlRes.json();
        if (!urlRes.ok) throw new Error(urlData.error || "Erro ao gerar URL de upload");

        // Use Supabase client to upload (handles CORS properly)
        const supabase = createClient();
        const { error: uploadError } = await supabase.storage
          .from("creatives")
          .uploadToSignedUrl(urlData.path, urlData.token, file, {
            contentType: file.type,
          });
        if (uploadError) throw new Error("Erro ao enviar vídeo para o storage");

        const registerRes = await fetch("/api/media", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            storage_path: urlData.path,
            account_id: uploadAccId,
            filename: file.name,
            mime_type: file.type,
            file_size: file.size,
          }),
        });
        data = await registerRes.json();
        if (!registerRes.ok) throw new Error(data.error || "Erro no registro de mídia");
      } else {
        // Images: existing FormData flow
        const formData = new FormData();
        formData.append("filename", file, file.name);
        formData.append("account_id", uploadAccId);

        const res = await fetch("/api/media", { method: "POST", body: formData, headers });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || "Erro no upload");
      }

      const hash = data.imageHash || null;
      const videoId = data.videoId || null;

      if (!hash && !videoId) throw new Error("ID de mídia não retornado");

      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, status: "done" as const, image_hash: hash, video_id: videoId, image_url: data.imageUrl } : a
        )
      );
    } catch (err: any) {
      console.error("Upload failed:", err);
      setAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: "error" as const } : a))
      );
    }
  }, [selectedAccountId, accountId, workspace?.id]);

  const handleGallerySelect = useCallback((items: MediaItem[]) => {
    const newAttachments = items.map((item) => ({
      id: item.id,
      file: new File([], item.filename),
      preview: item.image_url,
      status: "done" as const,
      image_hash: item.image_hash || undefined,
      video_id: (item as any).video_id || undefined,
      image_url: item.image_url,
    }));
    setAttachments((prev) => {
      // Avoid adding duplicates
      const newItems = newAttachments.filter(na => !prev.some(pa => pa.id === na.id));
      return [...prev, ...newItems];
    });
  }, []);

  // Load agents
  useEffect(() => {
    if (!workspace?.id) return;

    async function loadAgents() {
      try {
        const res = await fetch("/api/team/agents?slim=true", {
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

  // Auto-focus textarea when agent changes
  useEffect(() => {
    textareaRef.current?.focus();
  }, [selectedAgent?.id]);

  // Poll for completed background tasks
  const lastTaskCheckRef = useRef<string>(new Date().toISOString());
  useEffect(() => {
    if (!conversationId || !workspace?.id) return;

    const checkCompletedTasks = async () => {
      try {
        const params = new URLSearchParams({
          conversation_id: conversationId,
          status: "done",
          since: lastTaskCheckRef.current,
        });
        const res = await fetch(`/api/agent/tasks?${params}`, {
          headers: { "x-workspace-id": workspace!.id },
        });
        if (!res.ok) return;
        const data = await res.json();
        const tasks = data.tasks || [];
        if (tasks.length > 0) {
          lastTaskCheckRef.current = new Date().toISOString();
          for (const task of tasks) {
            const agentData = task.agent as { name: string; slug: string } | null;
            setMessages((prev) => [
              ...prev,
              {
                id: `task-done-${task.id}`,
                role: "assistant",
                content: `Tarefa concluída: **${task.title}**. Resultado disponível na [página de entregas](/team/deliverables).`,
                specialistResponses: agentData ? [{
                  agent_name: agentData.name,
                  agent_color: "#10B981",
                  agent_slug: agentData.slug,
                  content: `Tarefa finalizada com sucesso.`,
                  model: "background",
                  status: "done" as const,
                }] : undefined,
              },
            ]);
          }
        }
      } catch {
        // Silently fail
      }
    };

    const interval = setInterval(checkCompletedTasks, 30_000);
    return () => clearInterval(interval);
  }, [conversationId, workspace?.id]);

  // Fetch conversations for selected agent
  const fetchConversations = useCallback(async () => {
    if (!workspace?.id || !selectedAccountId || !selectedAgent) return;
    setLoadingConversations(true);
    try {
      const params = new URLSearchParams({
        account_id: selectedAccountId,
        agent_id: selectedAgent.id,
        limit: "20",
      });
      const res = await fetch(`/api/agent/conversations?${params}`, {
        headers: { "x-workspace-id": workspace.id },
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingConversations(false);
    }
  }, [workspace?.id, selectedAccountId, selectedAgent]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Load a previous conversation
  const loadConversation = useCallback(async (convId: string) => {
    if (!workspace?.id) return;
    try {
      const res = await fetch(`/api/agent/conversations/${convId}`, {
        headers: { "x-workspace-id": workspace.id },
      });
      if (res.ok) {
        const data = await res.json();
        const loadedMessages: ChatMessage[] = (data.messages || []).map(
          (m: { id: string; role: "user" | "assistant"; content: string }) => ({
            id: m.id,
            role: m.role,
            content: m.content,
          })
        );
        setMessages(loadedMessages);
        setConversationId(convId);
      }
    } catch {
      // Silently fail
    }
  }, [workspace?.id]);

  const handleNewConversation = () => {
    setMessages([]);
    setConversationId(undefined);
    textareaRef.current?.focus();
  };

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
        // Collect already-uploaded attachments (uploaded immediately on attach)
        const readyAttachments = attachments
          .filter((a) => a.status === "done" && (a.image_hash || a.video_id))
          .map((a) => ({
            filename: a.file.name,
            image_hash: a.image_hash,
            video_id: a.video_id,
            image_url: a.image_url,
          }));
        
        // Remove attachment clearing to persist them across requests!
        // We leave them in the UI and in the attachments array.

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
            accountId: selectedAccountId || accountId,
            accountContext: {
              account_name: (accounts as Array<{ id: string; name?: string; currency?: string; timezone_name?: string }>)?.find((a) => a.id === (selectedAccountId || accountId))?.name || "Conta Meta",
              account_id: selectedAccountId || accountId,
              currency: (accounts as Array<{ id: string; currency?: string }>)?.find((a) => a.id === (selectedAccountId || accountId))?.currency || "BRL",
              timezone: (accounts as Array<{ id: string; timezone_name?: string }>)?.find((a) => a.id === (selectedAccountId || accountId))?.timezone_name || "America/Sao_Paulo",
            },
            conversationId,
            agentId: selectedAgent.id,
            attachments: readyAttachments.length > 0 ? readyAttachments : undefined,
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
                          content: `Tarefa criada para processamento em background. O resultado ficará disponível na página de entregas.`,
                          model: "background",
                          status: "done",
                        },
                      ];
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
                  fetchConversations();
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
    [accountId, selectedAccountId, workspace?.id, selectedAgent, isLoading, messages, conversationId, attachments, fetchConversations]
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
      <div className="flex h-[calc(100vh-4rem)] gap-0">
        <div className="w-64 border-r border-border bg-card/50 p-3">
          <div className="h-4 w-16 bg-muted animate-pulse rounded mb-3 mx-2" />
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                <div className="h-8 w-8 rounded-full bg-muted animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-20 bg-muted animate-pulse rounded" />
                  <div className="h-2.5 w-28 bg-muted animate-pulse rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-1" />
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

        {/* Conversations */}
        {selectedAgent && (
          <div className="p-3 border-t border-border">
            <button
              onClick={handleNewConversation}
              className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer mb-2"
            >
              <Plus className="h-4 w-4" />
              Nova conversa
            </button>

            {loadingConversations ? (
              <div className="space-y-2 px-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-8 bg-muted animate-pulse rounded" />
                ))}
              </div>
            ) : conversations.length > 0 ? (
              <div className="space-y-0.5">
                <h3 className="text-xs font-semibold text-muted-foreground px-2 mb-1">
                  Conversas recentes
                </h3>
                {conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => loadConversation(conv.id)}
                    className={cn(
                      "w-full flex items-start gap-2 rounded-lg px-3 py-2 text-xs transition-colors text-left cursor-pointer",
                      conversationId === conv.id
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <MessageCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        {conv.title || "Sem titulo"}
                      </div>
                      <div className="text-[10px] opacity-60 mt-0.5">
                        {formatRelativeDate(conv.updated_at)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
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
                          <div className="px-3 py-2 bg-background/50">
                            <MessageContent content={sr.content} className="text-xs" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Text */}
                {msg.content && (
                  <MessageContent content={msg.content} isUser={msg.role === "user"} />
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
          <div className="max-w-4xl mx-auto">
            {accounts.length > 1 && (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-muted-foreground">Conta:</span>
                <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                  <SelectTrigger className="h-7 w-auto text-xs">
                    <SelectValue placeholder="Selecione a conta" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a: { id: string; name?: string; account_id?: string }) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name || a.account_id || a.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {attachments.length > 0 && (
              <div className="flex gap-2 mb-2 flex-wrap">
                {attachments.map((att) => (
                  <div key={att.id} className="relative group">
                    {(att.file.type.startsWith("video/") || att.video_id) ? (
                      <video
                        src={att.preview}
                        className="h-16 w-16 rounded-lg object-cover border border-border"
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <img
                        src={att.preview}
                        alt={att.file.name}
                        className="h-16 w-16 rounded-lg object-cover border border-border"
                      />
                    )}
                    {att.status === "uploading" && (
                      <div className="absolute inset-0 rounded-lg bg-black/40 flex items-center justify-center">
                        <Loader2 className="h-5 w-5 text-white animate-spin" />
                      </div>
                    )}
                    {att.status === "done" && (
                      <div className="absolute bottom-0.5 right-0.5 h-4 w-4 rounded-full bg-green-500 flex items-center justify-center">
                        <Check className="h-3 w-3 text-white" />
                      </div>
                    )}
                    {att.status === "error" && (
                      <div className="absolute inset-0 rounded-lg bg-red-500/30 flex items-center justify-center">
                        <AlertCircle className="h-5 w-5 text-white" />
                      </div>
                    )}
                    <button
                      onClick={() => {
                        URL.revokeObjectURL(att.preview);
                        setAttachments((prev) => prev.filter((a) => a.id !== att.id));
                      }}
                      className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-end">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  for (const file of files) {
                    const id = Math.random().toString(36).slice(2);
                    const preview = URL.createObjectURL(file);
                    setAttachments((prev) => [...prev, { id, file, preview, status: "uploading" }]);
                    uploadFile(id, file);
                  }
                  e.target.value = "";
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || !selectedAgent || !selectedAccountId}
                title="Anexar criativos"
              >
                <ImagePlus className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0"
                onClick={() => setGalleryOpen(true)}
                disabled={isLoading || !selectedAgent || !workspace?.id}
                title="Galeria de mídias"
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
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
                autoFocus
                rows={1}
              />
              <Button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isLoading || !selectedAgent || isUploading}
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
      </div>

      {workspace?.id && (
        <GalleryPicker
          open={galleryOpen}
          onOpenChange={setGalleryOpen}
          workspaceId={workspace.id}
          onSelect={handleGallerySelect}
        />
      )}
    </div>
  );
}
