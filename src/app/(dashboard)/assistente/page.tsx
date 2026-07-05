"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  Bot,
  Check,
  Clock,
  Loader2,
  MessageSquare,
  Save,
  ThumbsDown,
  TrendingDown,
  TrendingUp,
  Wrench,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
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
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useChartTheme } from "@/hooks/use-chart-theme";
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
  global_enabled?: boolean | null;
  global_welcome?: string | null;
  global_suggestions?: string[] | null;
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

// --- Types do dashboard analítico ---

interface DashboardKpis {
  conversations_7d: number;
  conversations_prev7d: number;
  user_messages_7d: number;
  user_messages_prev7d: number;
  feedback_up_30d: number;
  feedback_down_30d: number;
  avg_msgs_per_conversation_30d: number;
  messages_today: number;
  daily_cap: number;
  named_rate_30d: number;
}

interface DailyPoint {
  date: string;
  conversas: number;
  mensagens: number;
}

interface IntentPoint {
  intent: string;
  conversations: number;
  pct: number;
}

interface TopProduct {
  product_id: string;
  name: string;
  conversations: number;
}

interface HourlyPoint {
  hour: number;
  count: number;
}

interface NegativeFeedbackItem {
  message_id: number;
  conversation_id: string;
  excerpt: string;
  created_at: string;
}

interface FunnelData {
  window_days: number;
  steps: {
    sessions: number;
    viewed_product: number;
    added_to_cart: number;
    checkout: number;
    purchased: number;
  };
  rates: { atc_rate: number; handoff_rate: number; conversion_rate: number };
  revenue_confirmed: number;
  orders_confirmed: number;
  avg_ticket: number;
  pending_attribution: number;
  top_products: Array<{ sku: string; name: string; orders: number; revenue: number }>;
}

interface DashboardData {
  kpis: DashboardKpis;
  daily: DailyPoint[];
  intents: IntentPoint[];
  top_products: TopProduct[];
  hourly: HourlyPoint[];
  negative_feedback: NegativeFeedbackItem[];
  funnel?: FunnelData | null;
}

interface AdminResponse {
  settings: ApiSettings | null;
  conversations: ConversationSummary[];
  metrics?: AdminMetrics;
  dashboard?: DashboardData | null;
}

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
  global_enabled?: boolean;
  global_welcome?: string;
  global_suggestions?: string[];
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

// Cores de série (visíveis em ambos os temas)
const COLOR_CONVERSAS = "#6366f1";
const COLOR_MENSAGENS = "#22c55e";
const COLOR_HOURLY = "#f97316";

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

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return formatDate(iso);
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.round(h / 24);
  if (days < 30) return `há ${days} d`;
  return formatDate(iso);
}

function formatNumber(n: number): string {
  return n.toLocaleString("pt-BR");
}

function formatDecimal(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatPct(fraction: number): string {
  return `${(fraction * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
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

// --- Subcomponentes leves ---

/** Delta % vs período anterior. Verde ▲ / vermelho ▼; trata prev = 0. */
function Delta({ current, prev }: { current: number; prev: number }) {
  if (prev === 0) {
    if (current === 0) {
      return <span className="text-xs text-muted-foreground">—</span>;
    }
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-green-600 dark:text-green-400">
        <TrendingUp className="h-3 w-3" />
        novo
      </span>
    );
  }
  const rounded = Math.round(((current - prev) / prev) * 100);
  if (rounded === 0) {
    return <span className="text-xs text-muted-foreground">0% vs 7d ant.</span>;
  }
  const up = rounded > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        up ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
      }`}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? "+" : ""}
      {rounded}% vs 7d ant.
    </span>
  );
}

// --- Componente ---

export default function AssistentePage() {
  const { workspace } = useWorkspace();
  const chart = useChartTheme();

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

  // Chat Commerce v2 (modo global / página /chat)
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [globalWelcome, setGlobalWelcome] = useState("");
  const [globalSuggestionsText, setGlobalSuggestionsText] = useState("");

  // Conversas + métricas + dashboard
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [metrics, setMetrics] = useState<AdminMetrics>(EMPTY_METRICS);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

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
    setGlobalEnabled(s.global_enabled === true);
    setGlobalWelcome(s.global_welcome || "");
    setGlobalSuggestionsText((s.global_suggestions || []).join("\n"));
  }, []);

  const loadData = useCallback(async () => {
    if (!workspace?.id) return;
    try {
      const res = await fetch("/api/assistant/admin", { headers: headers() });
      const data = (await res.json()) as AdminResponse;
      applySettings(data.settings);
      setConversations(data.conversations || []);
      setMetrics({ ...EMPTY_METRICS, ...(data.metrics || {}) });
      setDashboard(data.dashboard ?? null);
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
        global_enabled: globalEnabled,
        global_welcome: globalWelcome.trim(),
        global_suggestions: globalSuggestionsText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 6),
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

  /** Abre a transcrição a partir de um conversation_id (usado pela fila de 👎). */
  function openTranscriptById(conversationId: string) {
    const existing = conversations.find((c) => c.id === conversationId);
    const now = new Date().toISOString();
    const conv: ConversationSummary = existing ?? {
      id: conversationId,
      product_id: null,
      page_url: null,
      message_count: 0,
      created_at: now,
      last_message_at: now,
      customer_name: null,
    };
    void openTranscript(conv);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // --- KPIs (dashboard OU fallback para métricas 7d) ---
  const k: DashboardKpis = dashboard?.kpis ?? {
    conversations_7d: metrics.conversations_7d,
    conversations_prev7d: 0,
    user_messages_7d: metrics.user_messages_7d,
    user_messages_prev7d: 0,
    feedback_up_30d: metrics.feedback_up_7d,
    feedback_down_30d: metrics.feedback_down_7d,
    avg_msgs_per_conversation_30d:
      metrics.conversations_7d > 0
        ? metrics.user_messages_7d / metrics.conversations_7d
        : 0,
    messages_today: 0,
    daily_cap: Number(dailyCapText) || DEFAULT_DAILY_CAP,
    named_rate_30d: 0,
  };

  const feedbackTotal = k.feedback_up_30d + k.feedback_down_30d;
  const satisfactionValue =
    feedbackTotal > 0
      ? `${Math.round((k.feedback_up_30d / feedbackTotal) * 100)}%`
      : "—";
  const satisfactionSubtitle =
    feedbackTotal > 0
      ? `${formatNumber(k.feedback_up_30d)} 👍 · ${formatNumber(
          k.feedback_down_30d
        )} 👎`
      : "sem avaliações ainda";
  const namedPct = Math.round((k.named_rate_30d || 0) * 100);
  const capUsedPct =
    k.daily_cap > 0
      ? Math.min(100, Math.round((k.messages_today / k.daily_cap) * 100))
      : 0;

  // --- Dados dos gráficos ---
  const daily = dashboard?.daily ?? [];
  const hasDaily = daily.some((d) => d.conversas > 0 || d.mensagens > 0);

  const intents = dashboard?.intents ?? [];
  const maxIntentPct = Math.max(1, ...intents.map((i) => i.pct));

  const topProducts = dashboard?.top_products ?? [];
  const maxProd = Math.max(1, ...topProducts.map((p) => p.conversations));

  // --- Funil de conversão (Chat Commerce) ---
  const funnel = dashboard?.funnel ?? null;

  const hourlyRaw = dashboard?.hourly ?? [];
  const hasHourly = hourlyRaw.some((h) => h.count > 0);
  const hourlyData = Array.from({ length: 24 }, (_, hour) => {
    const found = hourlyRaw.find((x) => x.hour === hour);
    return { hora: `${hour}h`, mensagens: found?.count ?? 0 };
  });

  const negativeFeedback = dashboard?.negative_feedback ?? [];

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

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="funil">Funil</TabsTrigger>
          <TabsTrigger value="conversas">Conversas</TabsTrigger>
          <TabsTrigger value="config">Configuração</TabsTrigger>
        </TabsList>

        {/* ==================== TAB 1: Visão geral ==================== */}
        <TabsContent value="overview" className="space-y-6">
          {!dashboard && (
            <p className="text-xs text-muted-foreground">
              Métricas detalhadas indisponíveis no momento — mostrando resumo dos
              últimos 7 dias.
            </p>
          )}

          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-3xl font-bold">
                  {formatNumber(k.conversations_7d)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Conversas (7d)
                </div>
                <div className="mt-1">
                  <Delta
                    current={k.conversations_7d}
                    prev={k.conversations_prev7d}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-3xl font-bold">
                  {formatNumber(k.user_messages_7d)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Mensagens de clientes (7d)
                </div>
                <div className="mt-1">
                  <Delta
                    current={k.user_messages_7d}
                    prev={k.user_messages_prev7d}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-3xl font-bold">{satisfactionValue}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Satisfação (30d)
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {satisfactionSubtitle}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-3xl font-bold">
                  {formatDecimal(k.avg_msgs_per_conversation_30d)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Msgs por conversa (30d)
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {namedPct}% informaram o nome
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-3xl font-bold">
                  {formatNumber(k.messages_today)}
                  <span className="text-base font-normal text-muted-foreground">
                    {" "}
                    / {formatNumber(k.daily_cap)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Uso hoje (custo)
                </div>
                <Progress value={capUsedPct} className="mt-2 h-1.5" />
              </CardContent>
            </Card>
          </div>

          {/* Volume chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Volume — últimos 14 dias
              </CardTitle>
            </CardHeader>
            <CardContent>
              {hasDaily ? (
                <div className="h-[260px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={daily}
                      margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                    >
                      <defs>
                        <linearGradient
                          id="grad-conversas"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor={COLOR_CONVERSAS}
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor={COLOR_CONVERSAS}
                            stopOpacity={0}
                          />
                        </linearGradient>
                        <linearGradient
                          id="grad-mensagens"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor={COLOR_MENSAGENS}
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor={COLOR_MENSAGENS}
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                      <XAxis
                        dataKey="date"
                        stroke={chart.axis}
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke={chart.axis}
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip contentStyle={chart.tooltipStyle} />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="conversas"
                        name="Conversas"
                        stroke={COLOR_CONVERSAS}
                        fill="url(#grad-conversas)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="mensagens"
                        name="Mensagens"
                        stroke={COLOR_MENSAGENS}
                        fill="url(#grad-mensagens)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-12 text-center">
                  Sem volume nos últimos 14 dias.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Two-column: intenções + horários */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Intenções */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  O que os clientes buscam
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  % das conversas (30d) que usaram cada recurso
                </p>
              </CardHeader>
              <CardContent>
                {intents.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-12 text-center">
                    Sem dados de intenção ainda.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {intents.map((it) => (
                      <div key={it.intent} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate">{it.intent}</span>
                          <span className="shrink-0 text-muted-foreground tabular-nums">
                            {formatNumber(it.conversations)} ·{" "}
                            {Math.round(it.pct)}%
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{
                              width: `${Math.max(
                                2,
                                (it.pct / maxIntentPct) * 100
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Horários de pico */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Horários de maior movimento
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Mensagens de clientes por hora (fuso de São Paulo, 14d)
                </p>
              </CardHeader>
              <CardContent>
                {hasHourly ? (
                  <div className="h-[220px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={hourlyData}
                        margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke={chart.grid}
                        />
                        <XAxis
                          dataKey="hora"
                          stroke={chart.axis}
                          fontSize={10}
                          tickLine={false}
                          interval={1}
                        />
                        <YAxis
                          stroke={chart.axis}
                          fontSize={12}
                          tickLine={false}
                          allowDecimals={false}
                        />
                        <Tooltip
                          contentStyle={chart.tooltipStyle}
                          formatter={(v) => [formatNumber(Number(v)), "Mensagens"]}
                        />
                        <Bar
                          dataKey="mensagens"
                          name="Mensagens"
                          fill={COLOR_HOURLY}
                          radius={[3, 3, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-12 text-center">
                    Sem movimento registrado ainda.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top produtos */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Produtos que mais geram conversa
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Nenhum produto com conversas ainda.
                </p>
              ) : (
                <div className="space-y-3">
                  {topProducts.map((p) => (
                    <div key={p.product_id} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate">
                          {p.name || `Produto ${p.product_id}`}
                        </span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {formatNumber(p.conversations)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${Math.max(
                              2,
                              (p.conversations / maxProd) * 100
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Fila de insatisfação */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ThumbsDown className="h-4 w-4" />
                Respostas marcadas com 👎 — revisar
              </CardTitle>
            </CardHeader>
            <CardContent>
              {negativeFeedback.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Nenhuma resposta negativa. 🎉
                </p>
              ) : (
                <div className="space-y-2">
                  {negativeFeedback.map((nf) => (
                    <button
                      key={nf.message_id}
                      type="button"
                      onClick={() => openTranscriptById(nf.conversation_id)}
                      className="w-full text-left rounded-lg border border-border p-3 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-foreground line-clamp-2">
                          {nf.excerpt || "(sem texto)"}
                        </p>
                        <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
                          {formatRelative(nf.created_at)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== TAB: Funil de conversão ==================== */}
        <TabsContent value="funil" className="space-y-6">
          {!funnel || funnel.steps.sessions === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">
                  Sem dados de funil ainda.
                </p>
                <p>
                  O funil mede a conversão real do Chat Commerce (/chat): sessão →
                  viu produto → adicionou à sacola → checkout → compra, com a
                  receita real vinda do webhook da VNDA.
                </p>
                <p>
                  Para ativar: aplique a migration <code>133-assistant-funnel</code>{" "}
                  e deixe o chat receber conversas. Os números aparecem aqui em
                  seguida.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* KPIs de conversão */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-3xl font-bold">
                      {formatNumber(funnel.steps.sessions)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Sessões engajadas ({funnel.window_days}d)
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-3xl font-bold">
                      {formatPct(funnel.rates.atc_rate)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Adicionou à sacola
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-3xl font-bold">
                      {formatPct(funnel.rates.conversion_rate)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Conversão sessão → pedido
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-3xl font-bold">
                      {formatBRL(funnel.revenue_confirmed)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Receita atribuída (real)
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatNumber(funnel.orders_confirmed)} pedidos
                      {funnel.pending_attribution > 0
                        ? ` · ${formatNumber(funnel.pending_attribution)} aguardando`
                        : ""}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-3xl font-bold">
                      {formatBRL(funnel.avg_ticket)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Ticket médio (chat)
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Funil visual */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Funil de conversão ({funnel.window_days} dias)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(() => {
                    const s = funnel.steps;
                    const base = Math.max(1, s.sessions);
                    const rows: Array<{ label: string; value: number; hint?: string }> = [
                      { label: "Sessões engajadas", value: s.sessions },
                      { label: "Viu produto", value: s.viewed_product },
                      { label: "Adicionou à sacola", value: s.added_to_cart },
                      { label: "Foi ao checkout", value: s.checkout },
                      { label: "Comprou", value: s.purchased },
                    ];
                    return rows.map((r) => {
                      const pct = Math.round((r.value / base) * 100);
                      return (
                        <div key={r.label} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span>{r.label}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {formatNumber(r.value)} · {pct}%
                            </span>
                          </div>
                          <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                        </div>
                      );
                    });
                  })()}
                  <p className="text-xs text-muted-foreground pt-1">
                    Taxa de handoff (checkout ÷ sacola): {formatPct(funnel.rates.handoff_rate)}.
                    Receita confirmada pelo webhook da VNDA (valor real, não estimado).
                  </p>
                </CardContent>
              </Card>

              {/* Top produtos que converteram */}
              {funnel.top_products.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      Produtos que mais converteram no chat
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {funnel.top_products.map((p) => {
                        const maxRev = Math.max(1, ...funnel.top_products.map((x) => x.revenue));
                        return (
                          <div key={p.sku} className="space-y-1">
                            <div className="flex items-center justify-between text-sm gap-3">
                              <span className="truncate">{p.name}</span>
                              <span className="tabular-nums text-muted-foreground shrink-0">
                                {formatBRL(p.revenue)} · {formatNumber(p.orders)}{" "}
                                {p.orders === 1 ? "pedido" : "pedidos"}
                              </span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full bg-primary/70"
                                style={{ width: `${Math.round((p.revenue / maxRev) * 100)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ==================== TAB 2: Conversas ==================== */}
        <TabsContent value="conversas" className="space-y-6">
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
                  Nenhuma conversa ainda. Ative o assistente em um produto e
                  teste na loja.
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
        </TabsContent>

        {/* ==================== TAB 3: Configuração ==================== */}
        <TabsContent value="config" className="space-y-6">
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
                  <Label htmlFor="max-messages">
                    Máx. mensagens por conversa
                  </Label>
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

              {/* ===== Chat Commerce v2 (página /chat global) ===== */}
              <div className="rounded-lg border border-dashed p-4 space-y-4 mt-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Label className="text-base">Chat Commerce (página /chat)</Label>
                      <Badge variant={globalEnabled ? "default" : "secondary"}>
                        {globalEnabled ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 max-w-prose">
                      Vitrine + vendedor + carrinho numa página de chat só sua, pra
                      onde você direciona tráfego. Separado do widget da PDP (que
                      continua igual). Requer a migration-132 e a env
                      ASSISTANT_PUBLIC_KEY.
                    </p>
                  </div>
                  <Switch checked={globalEnabled} onCheckedChange={setGlobalEnabled} />
                </div>

                <a
                  href="/chat"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  Abrir /chat <ArrowUpRight className="h-3.5 w-3.5" />
                </a>

                <div className="space-y-1.5">
                  <Label htmlFor="global-welcome">Boas-vindas do chat global</Label>
                  <Textarea
                    id="global-welcome"
                    value={globalWelcome}
                    onChange={(e) => setGlobalWelcome(e.target.value)}
                    maxLength={400}
                    rows={3}
                    placeholder="Bem-vindo à Bulking. Me diz o que você procura ou toca numa sugestão aqui embaixo."
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="global-suggestions">
                    Sugestões do chat global (uma por linha, máx 6)
                  </Label>
                  <Textarea
                    id="global-suggestions"
                    value={globalSuggestionsText}
                    onChange={(e) => setGlobalSuggestionsText(e.target.value)}
                    rows={5}
                    placeholder={"O que tem de mais vendido?\nCamiseta oversized preta\nTem cupom hoje?\nMe ajuda a escolher um look"}
                  />
                </div>
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
                {saveError && <p className="text-sm text-red-600">{saveError}</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ==================== Dialog: Transcrição (compartilhado) ==================== */}
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
