"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Bot, Check, Loader2, MessageSquare, Save, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/lib/workspace-context";

// --- Types (contrato da API /api/assistant/admin) ---

interface ApiSettings {
  workspace_id: string;
  enabled: boolean;
  product_ids: string[] | null;
  model: string | null;
  title: string | null;
  welcome_message: string | null;
  suggestions: string[] | null;
  store_info: string | null;
  max_messages_per_session: number | null;
  daily_message_cap: number | null;
}

interface ConversationSummary {
  id: string;
  product_id: string | null;
  page_url: string | null;
  message_count: number;
  created_at: string;
  last_message_at: string;
  customer_name: string | null;
}

interface TranscriptMessage {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string;
  created_at: string;
  /** Só em mensagens do assistente: 1 = útil, -1 = não útil */
  feedback?: 1 | -1 | null;
}

interface AdminMetrics {
  conversations_7d: number;
  user_messages_7d: number;
  feedback_up_7d: number;
  feedback_down_7d: number;
}

const EMPTY_METRICS: AdminMetrics = {
  conversations_7d: 0,
  user_messages_7d: 0,
  feedback_up_7d: 0,
  feedback_down_7d: 0,
};

interface SettingsUpdatePayload {
  enabled: boolean;
  product_ids: string[];
  model: string;
  title: string;
  welcome_message: string;
  suggestions: string[];
  store_info: string;
  max_messages_per_session?: number;
  daily_message_cap?: number;
}

// --- Defaults (espelham src/lib/assistant/settings.ts) ---

const DEFAULT_TITLE = "Assistente Bulking";
const DEFAULT_WELCOME =
  "Fala! Sou o assistente da loja. Posso te ajudar com tamanho, tecido, disponibilidade e recomendações. O que você precisa?";
const DEFAULT_SUGGESTIONS = [
  "Qual tamanho ideal pra mim?",
  "Esse tecido é dry ou algodão?",
  "Me recomenda produtos parecidos",
];
const DEFAULT_MAX_MESSAGES = 30;
const DEFAULT_DAILY_CAP = 1500;

// --- Helpers ---

function parseProductIds(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncateUrl(url: string | null): string {
  if (!url) return "—";
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/** Content do role "tool" é um JSON de Array<{ name, input, ok }> — extrai só os nomes. */
function parseToolNames(content: string): string[] {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (entry && typeof entry === "object" && "name" in entry) {
          const name = (entry as { name: unknown }).name;
          return typeof name === "string" ? name : null;
        }
        return null;
      })
      .filter((n): n is string => Boolean(n));
  } catch {
    return [];
  }
}

// --- Componente ---

export default function AssistentePage() {
  const { workspace } = useWorkspace();

  // Form (settings)
  const [enabled, setEnabled] = useState(false);
  const [productIdsText, setProductIdsText] = useState("");
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [welcomeMessage, setWelcomeMessage] = useState(DEFAULT_WELCOME);
  const [suggestionsText, setSuggestionsText] = useState(
    DEFAULT_SUGGESTIONS.join("\n")
  );
  const [storeInfo, setStoreInfo] = useState("");
  const [maxMessagesText, setMaxMessagesText] = useState(
    String(DEFAULT_MAX_MESSAGES)
  );
  const [dailyCapText, setDailyCapText] = useState(String(DEFAULT_DAILY_CAP));
  const [modelText, setModelText] = useState("");

  // Conversas + métricas
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [metrics, setMetrics] = useState<AdminMetrics>(EMPTY_METRICS);

  // UI state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Transcrição
  const [openConversation, setOpenConversation] =
    useState<ConversationSummary | null>(null);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "x-workspace-id": workspace?.id || "",
    }),
    [workspace?.id]
  );

  const applySettings = useCallback((s: ApiSettings | null) => {
    if (!s) return; // null = nunca configurado → mantém defaults do form
    setEnabled(s.enabled === true);
    setProductIdsText((s.product_ids || []).join(", "));
    setTitle(s.title || DEFAULT_TITLE);
    setWelcomeMessage(s.welcome_message || DEFAULT_WELCOME);
    setSuggestionsText(
      (s.suggestions && s.suggestions.length > 0
        ? s.suggestions
        : DEFAULT_SUGGESTIONS
      ).join("\n")
    );
    setStoreInfo(s.store_info || "");
    setMaxMessagesText(
      String(s.max_messages_per_session ?? DEFAULT_MAX_MESSAGES)
    );
    setDailyCapText(String(s.daily_message_cap ?? DEFAULT_DAILY_CAP));
    setModelText(s.model || "");
  }, []);

  const loadData = useCallback(async () => {
    if (!workspace?.id) return;
    try {
      const res = await fetch("/api/assistant/admin", { headers: headers() });
      const data = (await res.json()) as {
        settings: ApiSettings | null;
        conversations: ConversationSummary[];
        metrics?: AdminMetrics;
      };
      applySettings(data.settings);
      setConversations(data.conversations || []);
      setMetrics({ ...EMPTY_METRICS, ...(data.metrics || {}) });
    } catch (err) {
      console.error("Failed to load assistant admin data:", err);
    }
  }, [workspace?.id, headers, applySettings]);

  useEffect(() => {
    if (workspace?.id) {
      loadData().finally(() => setLoading(false));
    }
  }, [workspace?.id, loadData]);

  async function handleSave() {
    if (!workspace?.id) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const payload: SettingsUpdatePayload = {
        enabled,
        product_ids: parseProductIds(productIdsText),
        model: modelText.trim(),
        title: title.trim(),
        welcome_message: welcomeMessage.trim(),
        suggestions: suggestionsText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 4),
        store_info: storeInfo,
      };
      const maxMessages = Number(maxMessagesText);
      if (Number.isFinite(maxMessages) && maxMessages >= 1) {
        payload.max_messages_per_session = maxMessages;
      }
      const dailyCap = Number(dailyCapText);
      if (Number.isFinite(dailyCap) && dailyCap >= 10) {
        payload.daily_message_cap = dailyCap;
      }

      const res = await fetch("/api/assistant/admin", {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        settings?: ApiSettings;
        error?: string;
      };
      if (!res.ok || !data.settings) {
        throw new Error(data.error || "Falha ao salvar");
      }
      applySettings(data.settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Failed to save assistant settings:", err);
      setSaveError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function openTranscript(conv: ConversationSummary) {
    setOpenConversation(conv);
    setTranscript([]);
    setTranscriptLoading(true);
    try {
      const res = await fetch(
        `/api/assistant/admin?conversation_id=${encodeURIComponent(conv.id)}`,
        { headers: headers() }
      );
      const data = (await res.json()) as { messages?: TranscriptMessage[] };
      setTranscript(data.messages || []);
    } catch (err) {
      console.error("Failed to load transcript:", err);
    } finally {
      setTranscriptLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Métricas derivadas (7d)
  const feedbackTotal = metrics.feedback_up_7d + metrics.feedback_down_7d;
  const satisfactionValue =
    feedbackTotal > 0
      ? `${Math.round((metrics.feedback_up_7d / feedbackTotal) * 100)}%`
      : "—";
  const satisfactionSubtitle =
    feedbackTotal > 0
      ? `${metrics.feedback_up_7d} 👍 · ${metrics.feedback_down_7d} 👎`
      : "sem avaliações ainda";
  const msgsPerConversation =
    metrics.conversations_7d > 0
      ? (metrics.user_messages_7d / metrics.conversations_7d).toFixed(1)
      : "—";

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Bot className="h-6 w-6" />
        <div>
          <h1 className="text-2xl font-bold">Assistente de Vendas</h1>
          <p className="text-sm text-muted-foreground">
            Vendedor virtual com IA na loja — tire dúvidas de tamanho, tecido e
            recomende produtos
          </p>
        </div>
      </div>

      {/* ==================== Métricas (7d) ==================== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold">{metrics.conversations_7d}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Conversas (7d)
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold">{metrics.user_messages_7d}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Mensagens de clientes (7d)
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold">{satisfactionValue}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Satisfação (7d)
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {satisfactionSubtitle}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold">{msgsPerConversation}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Msgs por conversa (7d)
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ==================== Seção 1: Configuração ==================== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuração</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-3">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <div className="flex items-center gap-2">
              <Label>Ativar assistente</Label>
              <Badge variant={enabled ? "default" : "secondary"}>
                {enabled ? "Ativo" : "Inativo"}
              </Badge>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="product-ids">
              Produtos liberados (IDs VNDA, separados por vírgula)
            </Label>
            <Input
              id="product-ids"
              value={productIdsText}
              onChange={(e) => setProductIdsText(e.target.value)}
              placeholder="1271, 1305"
            />
            <p className="text-xs text-muted-foreground">
              Comece com 1 produto. Use * para liberar em todas as PDPs.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="widget-title">Título do widget</Label>
            <Input
              id="widget-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={60}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="welcome-message">Mensagem de boas-vindas</Label>
            <Textarea
              id="welcome-message"
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              maxLength={300}
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="suggestions">
              Sugestões iniciais (uma por linha, máx 4)
            </Label>
            <Textarea
              id="suggestions"
              value={suggestionsText}
              onChange={(e) => setSuggestionsText(e.target.value)}
              rows={4}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="store-info">
              Políticas da loja (trocas, frete, pagamento)
            </Label>
            <Textarea
              id="store-info"
              value={storeInfo}
              onChange={(e) => setStoreInfo(e.target.value)}
              maxLength={4000}
              rows={5}
              placeholder="Ex.: Primeira troca grátis em até 30 dias. Frete grátis acima de R$ 299 (Sudeste)..."
            />
            <p className="text-xs text-muted-foreground">
              O assistente SÓ afirma políticas escritas aqui. Vazio = ele
              orienta procurar o atendimento.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="max-messages">Máx. mensagens por conversa</Label>
              <Input
                id="max-messages"
                type="number"
                min={1}
                max={200}
                value={maxMessagesText}
                onChange={(e) => setMaxMessagesText(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="daily-cap">Cap diário de mensagens</Label>
              <Input
                id="daily-cap"
                type="number"
                min={10}
                max={50000}
                value={dailyCapText}
                onChange={(e) => setDailyCapText(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="model">Modelo (OpenRouter)</Label>
            <Input
              id="model"
              value={modelText}
              onChange={(e) => setModelText(e.target.value)}
              placeholder="anthropic/claude-haiku-4.5 (padrão)"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : saved ? (
                <Check className="h-4 w-4 mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {saved ? "Salvo!" : "Salvar"}
            </Button>
            {saveError && (
              <p className="text-sm text-red-600">{saveError}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ==================== Seção 2: Conversas ==================== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Conversas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {conversations.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nenhuma conversa ainda. Ative o assistente em um produto e teste
              na loja.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Última mensagem</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Mensagens</TableHead>
                  <TableHead>Página</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conversations.map((conv) => (
                  <TableRow
                    key={conv.id}
                    className="cursor-pointer"
                    onClick={() => openTranscript(conv)}
                  >
                    <TableCell className="whitespace-nowrap">
                      {formatDate(conv.last_message_at)}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate">
                      {conv.customer_name || "—"}
                    </TableCell>
                    <TableCell>{conv.product_id || "—"}</TableCell>
                    <TableCell className="text-right">
                      {conv.message_count}
                    </TableCell>
                    <TableCell
                      className="max-w-[280px] truncate text-muted-foreground"
                      title={conv.page_url || undefined}
                    >
                      {truncateUrl(conv.page_url)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ==================== Dialog: Transcrição ==================== */}
      <Dialog
        open={openConversation !== null}
        onOpenChange={(open) => {
          if (!open) setOpenConversation(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Conversa</DialogTitle>
            <DialogDescription>
              {openConversation
                ? `Produto ${openConversation.product_id || "—"} · ${formatDate(
                    openConversation.last_message_at
                  )}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {transcriptLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : transcript.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Nenhuma mensagem nesta conversa.
              </p>
            ) : (
              transcript.map((msg) => {
                if (msg.role === "tool") {
                  const tools = parseToolNames(msg.content);
                  return (
                    <div key={msg.id} className="flex justify-center">
                      <Badge
                        variant="outline"
                        className="text-xs font-normal text-muted-foreground gap-1"
                      >
                        <Wrench className="h-3 w-3" />
                        {tools.length > 0
                          ? `consultas ao catálogo: ${tools.join(", ")}`
                          : "consultas ao catálogo"}
                      </Badge>
                    </div>
                  );
                }
                const isUser = msg.role === "user";
                const showFeedback =
                  msg.role === "assistant" &&
                  (msg.feedback === 1 || msg.feedback === -1);
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      isUser ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                        isUser
                          ? "bg-neutral-900 text-neutral-100"
                          : "bg-neutral-100 text-neutral-900"
                      }`}
                    >
                      {msg.content}
                    </div>
                    {showFeedback && (
                      <Badge
                        variant="outline"
                        className={`mt-1 text-xs font-normal ${
                          msg.feedback === 1
                            ? "border-green-600/60 text-green-700 dark:text-green-400"
                            : "border-red-600/60 text-red-700 dark:text-red-400"
                        }`}
                      >
                        {msg.feedback === 1 ? "👍 útil" : "👎 não útil"}
                      </Badge>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
