"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Star,
  Loader2,
  Check,
  Trash2,
  Download,
  Eye,
  EyeOff,
  XCircle,
  CheckCircle2,
  MessageSquareReply,
  Save,
  RefreshCw,
  KeyRound,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";

// ---------- Tipos ----------

interface Review {
  id: string;
  source: string;
  product_id: string | null;
  product_name: string | null;
  product_image: string | null;
  rating: number;
  title: string | null;
  body: string | null;
  author_name: string | null;
  author_email: string | null;
  verified_buyer: boolean;
  custom_fields: { name: string; values: string[] }[];
  media: { url: string; type: string }[];
  media_kind?: string;
  ads_consent?: boolean;
  ads_status?: string;
  reward_tier?: string | null;
  reward_status?: string;
  reward_amount?: number | null;
  status: string;
  reply_body: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface Stats {
  total: number;
  published_count: number;
  average: number;
  distribution: Record<string, number>;
  by_status: Record<string, number>;
  by_source: Record<string, number>;
  top_products: { product_id: string; product_name: string | null; count: number; average: number }[];
}

interface ReviewSettings {
  widget_enabled: boolean;
  accent_color: string;
  star_color: string;
  anchor_selector: string | null;
  show_verified_badge: boolean;
  show_custom_fields: boolean;
  reviews_per_page: number;
  auto_publish: boolean;
  request_enabled: boolean;
  request_channel: "whatsapp" | "email";
  request_trigger: "purchase" | "delivery";
  request_delay_days: number;
  request_require_invoice: boolean;
  request_days_after_invoice: number;
  request_ask_media: boolean;
  request_reminder_days: number | null;
  request_reminder_2_days: number | null;
  collect_store_review: boolean;
  request_message_template: string | null;
  request_reminder_message: string | null;
  request_reminder_2_message: string | null;
  wa_template_id: string | null;
  rewards_enabled: boolean;
  reward_photo_amount: number;
  reward_video_amount: number;
  reward_video_ads_amount: number;
  reward_validity_days: number;
  ads_enabled: boolean;
}

interface Connection {
  configured: boolean;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
  total_imported: number;
}

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  published: { label: "Publicada", variant: "default" },
  pending: { label: "Pendente", variant: "secondary" },
  rejected: { label: "Rejeitada", variant: "destructive" },
  hidden: { label: "Oculta", variant: "outline" },
};

function Stars({ n, size = 14 }: { n: number; size?: number }) {
  return (
    <span className="inline-flex">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          width={size}
          height={size}
          className={i <= n ? "fill-amber-400 text-amber-400" : "fill-muted text-muted-foreground/30"}
        />
      ))}
    </span>
  );
}

export default function ReviewsPage() {
  const { workspace } = useWorkspace();
  const [tab, setTab] = useState("moderation");

  const headers = useCallback(
    () => ({ "Content-Type": "application/json", "x-workspace-id": workspace?.id || "" }),
    [workspace?.id]
  );

  // Stats
  const [stats, setStats] = useState<Stats | null>(null);

  // Moderation
  const [reviews, setReviews] = useState<Review[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  // Connection / import
  const [connection, setConnection] = useState<Connection | null>(null);
  const [creds, setCreds] = useState({ store_key: "", api_username: "", api_password: "" });
  const [savingCreds, setSavingCreds] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Settings
  const [settings, setSettings] = useState<ReviewSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savedSettings, setSavedSettings] = useState(false);

  // Install
  const [apiKey, setApiKey] = useState<string | null>(null);

  // Store reviews (avaliações da loja)
  const [storeReviews, setStoreReviews] = useState<{ id: string; rating: number; comment: string | null; author_name: string | null; status: string; order_code: string | null; created_at: string }[]>([]);
  const [storeSummary, setStoreSummary] = useState<{ average: number; published: number } | null>(null);

  const loadStore = useCallback(async () => {
    if (!workspace?.id) return;
    const d = await fetch("/api/reviews/store", { headers: headers() }).then((r) => r.json());
    setStoreReviews(d.reviews || []);
    setStoreSummary(d.summary || null);
  }, [workspace?.id, headers]);

  async function moderateStore(id: string, status: string) {
    await fetch(`/api/reviews/store/${id}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ status }) });
    loadStore();
  }

  const loadStats = useCallback(async () => {
    if (!workspace?.id) return;
    const s = await fetch("/api/reviews/stats", { headers: headers() }).then((r) => r.json());
    if (!s.error) setStats(s);
  }, [workspace?.id, headers]);

  const loadList = useCallback(async () => {
    if (!workspace?.id) return;
    setLoadingList(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("q", search);
      const d = await fetch(`/api/reviews?${params.toString()}`, { headers: headers() }).then((r) => r.json());
      setReviews(d.reviews || []);
    } finally {
      setLoadingList(false);
    }
  }, [workspace?.id, headers, statusFilter, search]);

  const loadConnection = useCallback(async () => {
    if (!workspace?.id) return;
    const d = await fetch("/api/reviews/connection", { headers: headers() }).then((r) => r.json());
    setConnection(d.connection);
  }, [workspace?.id, headers]);

  const loadSettings = useCallback(async () => {
    if (!workspace?.id) return;
    const d = await fetch("/api/reviews/settings", { headers: headers() }).then((r) => r.json());
    if (d.settings) setSettings(d.settings);
  }, [workspace?.id, headers]);

  const loadKey = useCallback(async () => {
    if (!workspace?.id) return;
    const d = await fetch("/api/shelves/api-keys", { headers: headers() }).then((r) => r.json());
    setApiKey((d.keys || [])[0]?.key || null);
  }, [workspace?.id, headers]);

  useEffect(() => {
    if (workspace?.id) {
      loadStats();
      loadList();
      loadStore();
      loadConnection();
      loadSettings();
      loadKey();
    }
  }, [workspace?.id, loadStats, loadList, loadStore, loadConnection, loadSettings, loadKey]);

  useEffect(() => {
    if (workspace?.id) loadList();
  }, [statusFilter, loadList, workspace?.id]);

  async function moderate(id: string, status: string) {
    await fetch(`/api/reviews/${id}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ status }) });
    loadList();
    loadStats();
  }

  async function setAds(id: string, ads_status: string) {
    await fetch(`/api/reviews/${id}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ ads_status }) });
    loadList();
  }

  const [creatingTpl, setCreatingTpl] = useState(false);
  const [tplMsg, setTplMsg] = useState<string | null>(null);
  const [tplStatus, setTplStatus] = useState<{ status: string | null; name: string | null } | null>(null);
  const [checkingTpl, setCheckingTpl] = useState(false);
  async function createWaTemplate() {
    if (!workspace?.id) return;
    setCreatingTpl(true);
    setTplMsg(null);
    try {
      const res = await fetch("/api/reviews/create-utility-template", { method: "POST", headers: headers() });
      const d = await res.json();
      setTplMsg(d.ok ? d.message : d.error || "Erro ao criar template");
      if (d.ok) { loadSettings(); checkTemplateStatus(); }
    } catch {
      setTplMsg("Erro de conexão");
    } finally {
      setCreatingTpl(false);
    }
  }
  async function checkTemplateStatus() {
    if (!workspace?.id) return;
    setCheckingTpl(true);
    try {
      const res = await fetch("/api/reviews/template-status", { method: "POST", headers: headers() });
      const d = await res.json();
      if (d.error) { setTplMsg(d.error); setTplStatus(null); }
      else setTplStatus({ status: d.status, name: d.name });
    } catch {
      setTplMsg("Erro ao consultar status");
    } finally {
      setCheckingTpl(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Excluir esta avaliação permanentemente?")) return;
    await fetch(`/api/reviews/${id}`, { method: "DELETE", headers: headers() });
    loadList();
    loadStats();
  }

  async function sendReply(id: string) {
    await fetch(`/api/reviews/${id}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ reply_body: replyText }) });
    setReplyingId(null);
    setReplyText("");
    loadList();
  }

  async function saveCreds() {
    if (!workspace?.id) return;
    setSavingCreds(true);
    try {
      const res = await fetch("/api/reviews/connection", { method: "POST", headers: headers(), body: JSON.stringify(creds) });
      const d = await res.json();
      if (d.ok) {
        setCreds({ store_key: "", api_username: "", api_password: "" });
        loadConnection();
      } else {
        alert(d.error || "Erro ao salvar");
      }
    } finally {
      setSavingCreds(false);
    }
  }

  async function runSync() {
    if (!workspace?.id) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/reviews/sync", { method: "POST", headers: headers(), body: JSON.stringify({}) });
      const d = await res.json();
      if (d.ok) {
        setSyncMsg(
          `Importadas ${d.result.inserted} novas avaliações (${d.result.fetched} lidas em ${d.result.pages} páginas).` +
            (d.capped ? " Atingiu o limite por execução — rode novamente para continuar." : "")
        );
        loadConnection();
        loadStats();
        loadList();
      } else {
        setSyncMsg(d.error || "Erro na sincronização");
      }
    } catch {
      setSyncMsg("Erro de conexão");
    } finally {
      setSyncing(false);
    }
  }

  async function saveSettings() {
    if (!workspace?.id || !settings) return;
    setSavingSettings(true);
    setSavedSettings(false);
    try {
      const res = await fetch("/api/reviews/settings", { method: "PATCH", headers: headers(), body: JSON.stringify(settings) });
      const d = await res.json();
      if (d.settings) {
        setSettings(d.settings);
        setSavedSettings(true);
        setTimeout(() => setSavedSettings(false), 2500);
      }
    } finally {
      setSavingSettings(false);
    }
  }

  const set = <K extends keyof ReviewSettings>(k: K, v: ReviewSettings[K]) =>
    setSettings((s) => (s ? { ...s, [k]: v } : s));

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Star className="h-6 w-6 text-amber-400 fill-amber-400" />
          Avaliações
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Plataforma própria de avaliações de clientes — importe da Yourviews, modere, exiba na loja e colete novas no pós-compra.
        </p>
      </div>

      {/* KPIs */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-3xl font-bold flex items-center gap-2">
                {stats.average.toFixed(1)}
                <Stars n={Math.round(stats.average)} size={16} />
              </div>
              <div className="text-xs text-muted-foreground mt-1">Nota média (publicadas)</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-3xl font-bold">{stats.published_count}</div>
              <div className="text-xs text-muted-foreground mt-1">Publicadas</div>
            </CardContent>
          </Card>
          <Card
            role="button"
            tabIndex={0}
            onClick={() => { setStatusFilter("pending"); setTab("moderation"); }}
            onKeyDown={(e) => { if (e.key === "Enter") { setStatusFilter("pending"); setTab("moderation"); } }}
            className={`cursor-pointer transition-colors ${(stats.by_status?.pending || 0) > 0 ? "border-amber-400 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30" : "hover:bg-muted/50"}`}
          >
            <CardContent className="pt-6">
              <div className={`text-3xl font-bold ${(stats.by_status?.pending || 0) > 0 ? "text-amber-600" : ""}`}>{stats.by_status?.pending || 0}</div>
              <div className="text-xs text-muted-foreground mt-1">Aguardando aprovação →</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-3xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground mt-1">Total importadas + nativas</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="moderation">
            Moderação
            {(stats?.by_status?.pending || 0) > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 text-white text-[10px] font-semibold px-1.5 py-0.5 leading-none">
                {stats?.by_status?.pending}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="store">
            Avaliações da loja
            {storeSummary && storeSummary.published > 0 && (
              <span className="ml-1.5 text-[10px] text-muted-foreground">★ {storeSummary.average}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="import">Importar (Yourviews)</TabsTrigger>
          <TabsTrigger value="ruler">Régua de comunicação</TabsTrigger>
          <TabsTrigger value="settings">Configurações</TabsTrigger>
          <TabsTrigger value="install">Instalação</TabsTrigger>
        </TabsList>

        {/* ---------- Moderação ---------- */}
        <TabsContent value="moderation" className="space-y-4">
          {(stats?.by_status?.pending || 0) > 0 && statusFilter !== "pending" && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span><strong>{stats?.by_status?.pending}</strong> avaliação(ões) aguardando sua aprovação.</span>
              </div>
              <Button size="sm" variant="outline" className="border-amber-500 text-amber-700 hover:bg-amber-100" onClick={() => setStatusFilter("pending")}>
                Revisar pendentes
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="published">Publicadas</SelectItem>
                <SelectItem value="pending">Pendentes</SelectItem>
                <SelectItem value="hidden">Ocultas</SelectItem>
                <SelectItem value="rejected">Rejeitadas</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Buscar por texto, título ou autor…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadList()}
              className="max-w-xs"
            />
            <Button variant="outline" size="sm" onClick={loadList} disabled={loadingList}>
              {loadingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>

          {reviews.length === 0 && !loadingList && (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhuma avaliação encontrada.</CardContent></Card>
          )}

          <div className="space-y-3">
            {reviews.map((r) => (
              <Card key={r.id} className={r.status === "pending" ? "border-amber-400 border-l-4" : ""}>
                <CardContent className="pt-6">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Stars n={r.rating} />
                        <span className="font-semibold text-sm">{r.author_name || "Cliente"}</span>
                        {r.verified_buyer && <Badge variant="outline" className="text-[10px]">✓ Verificado</Badge>}
                        <Badge variant={STATUS_LABELS[r.status]?.variant || "secondary"} className="text-[10px]">
                          {STATUS_LABELS[r.status]?.label || r.status}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] capitalize">{r.source}</Badge>
                        {r.media_kind === "video" && <Badge variant="outline" className="text-[10px]">🎥 Vídeo</Badge>}
                        {r.media_kind === "photo" && <Badge variant="outline" className="text-[10px]">📸 Foto</Badge>}
                        {r.ads_status === "pending" && <Badge className="text-[10px] bg-purple-600 hover:bg-purple-600">ADS: revisar</Badge>}
                        {r.ads_status === "accepted" && <Badge className="text-[10px] bg-purple-600 hover:bg-purple-600">ADS ✓</Badge>}
                        {r.reward_status === "granted" && <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">🎁 R$ {r.reward_amount}</Badge>}
                        {r.reward_status === "failed" && <Badge variant="destructive" className="text-[10px]">recompensa falhou</Badge>}
                      </div>
                      {r.ads_status === "pending" && (
                        <div className="mt-2 flex items-center gap-2 rounded-md bg-purple-50 border border-purple-200 px-3 py-2">
                          <span className="text-xs text-purple-800 flex-1">Cliente autorizou usar o vídeo em ADS. Aprovar concede o cashback máximo.</span>
                          <Button size="sm" className="h-7 bg-purple-600 hover:bg-purple-700 text-white" onClick={() => setAds(r.id, "accepted")}>Aceitar p/ ADS</Button>
                          <Button size="sm" variant="outline" className="h-7" onClick={() => setAds(r.id, "rejected")}>Rejeitar</Button>
                        </div>
                      )}
                      {r.product_name && (
                        <div className="text-xs text-muted-foreground mt-1">Produto: {r.product_name}{r.product_id ? ` (${r.product_id})` : ""}</div>
                      )}
                      {r.title && <div className="font-semibold mt-2">{r.title}</div>}
                      {r.body && <p className="text-sm mt-1 text-muted-foreground whitespace-pre-line">{r.body}</p>}
                      {r.custom_fields?.length > 0 && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                          {r.custom_fields.map((f, i) => (
                            <span key={i} className="text-xs text-muted-foreground">
                              {f.name}: <span className="text-foreground font-medium">{f.values.join(", ")}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {r.media?.length > 0 && (
                        <div className="flex gap-2 mt-2">
                          {r.media.map((m, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={i} src={m.url} alt="" className="w-14 h-14 object-cover rounded-md border" />
                          ))}
                        </div>
                      )}
                      {r.reply_body && (
                        <div className="mt-2 bg-muted rounded-md p-2 text-xs">
                          <span className="font-semibold">Resposta da loja:</span> {r.reply_body}
                        </div>
                      )}
                      {replyingId === r.id && (
                        <div className="mt-3 flex gap-2">
                          <Textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Resposta pública…" className="text-sm" />
                          <div className="flex flex-col gap-1">
                            <Button size="sm" onClick={() => sendReply(r.id)}>Enviar</Button>
                            <Button size="sm" variant="ghost" onClick={() => setReplyingId(null)}>Cancelar</Button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      {r.status === "pending" ? (
                        <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => moderate(r.id, "published")} title="Aprovar e publicar">
                          <CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar
                        </Button>
                      ) : r.status !== "published" && (
                        <Button size="sm" variant="outline" className="text-green-600" onClick={() => moderate(r.id, "published")} title="Publicar">
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      )}
                      {r.status !== "hidden" && (
                        <Button size="sm" variant="outline" onClick={() => moderate(r.id, "hidden")} title="Ocultar">
                          <EyeOff className="h-4 w-4" />
                        </Button>
                      )}
                      {r.status !== "rejected" && (
                        <Button size="sm" variant="outline" onClick={() => moderate(r.id, "rejected")} title="Rejeitar">
                          <XCircle className="h-4 w-4" />
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => { setReplyingId(r.id); setReplyText(r.reply_body || ""); }} title="Responder">
                        <MessageSquareReply className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="outline" className="text-destructive" onClick={() => remove(r.id)} title="Excluir">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ---------- Avaliações da loja ---------- */}
        <TabsContent value="store" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Avaliações da <strong>experiência com a loja</strong> (entrega, atendimento), coletadas na mesma página da avaliação do produto — mas separadas dela.
          </p>
          {storeReviews.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">Nenhuma avaliação da loja ainda.</CardContent></Card>
          ) : (
            storeReviews.map((r) => (
              <Card key={r.id}>
                <CardContent className="pt-6 flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Stars n={r.rating} />
                      <span className="font-semibold text-sm">{r.author_name || "Cliente"}</span>
                      <Badge variant={STATUS_LABELS[r.status]?.variant || "secondary"} className="text-[10px]">{STATUS_LABELS[r.status]?.label || r.status}</Badge>
                      {r.order_code && <span className="text-[11px] text-muted-foreground">Pedido {r.order_code}</span>}
                    </div>
                    {r.comment && <p className="text-sm mt-1 text-muted-foreground">{r.comment}</p>}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {r.status !== "published" && (
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => moderateStore(r.id, "published")}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar
                      </Button>
                    )}
                    {r.status !== "hidden" && <Button size="sm" variant="outline" onClick={() => moderateStore(r.id, "hidden")}><EyeOff className="h-4 w-4" /></Button>}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* ---------- Importar (Yourviews) ---------- */}
        <TabsContent value="import" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Download className="h-5 w-5" /> Importar avaliações da Yourviews</CardTitle>
              <CardDescription>
                Carga inicial: puxa todas as avaliações que você já tem na Yourviews (API V1, paginada) pra dentro da sua plataforma.
                Idempotente — pode rodar de novo sem duplicar. Credenciais em <em>Conta &gt; Código da Loja &gt; Credencial de API</em>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {connection?.configured ? (
                <div className="rounded-lg border p-4 bg-muted/40 space-y-1 text-sm">
                  <div className="flex items-center gap-2 font-medium text-green-600"><Check className="h-4 w-4" /> Conexão configurada</div>
                  {connection.last_synced_at && (
                    <div className="text-muted-foreground">Última importação: {new Date(connection.last_synced_at).toLocaleString("pt-BR")}</div>
                  )}
                  {connection.last_sync_message && <div className="text-muted-foreground">{connection.last_sync_message}</div>}
                  {connection.last_sync_status === "error" && <div className="text-destructive">Status: erro</div>}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Nenhuma conexão configurada ainda.</div>
              )}

              <div className="grid gap-3">
                <div>
                  <Label>Store Key (Código da Loja / GUID)</Label>
                  <Input value={creds.store_key} onChange={(e) => setCreds({ ...creds, store_key: e.target.value })} placeholder="00000000-0000-0000-0000-000000000000" />
                </div>
                <div>
                  <Label>API Username</Label>
                  <Input value={creds.api_username} onChange={(e) => setCreds({ ...creds, api_username: e.target.value })} autoComplete="off" />
                </div>
                <div>
                  <Label>API Password</Label>
                  <Input type="password" value={creds.api_password} onChange={(e) => setCreds({ ...creds, api_password: e.target.value })} autoComplete="off" />
                </div>
                <div className="flex gap-2">
                  <Button onClick={saveCreds} disabled={savingCreds || !creds.store_key || !creds.api_username || !creds.api_password}>
                    {savingCreds ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                    Salvar credenciais
                  </Button>
                  <Button variant="secondary" onClick={runSync} disabled={syncing || !connection?.configured}>
                    {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                    Importar agora
                  </Button>
                </div>
                {syncMsg && <div className="text-sm text-muted-foreground border rounded-md p-3">{syncMsg}</div>}
                <p className="text-xs text-muted-foreground">
                  Para uma carga inicial muito grande, rode o script no servidor:&nbsp;
                  <code className="bg-muted px-1 rounded">npx tsx scripts/sync-yourviews-reviews.ts --workspace={workspace?.id || "<uuid>"} --apply</code>
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- Régua de comunicação ---------- */}
        <TabsContent value="ruler" className="space-y-4">
          {settings && (
            <Card>
              <CardHeader>
                <CardTitle>Régua de comunicação pós-compra</CardTitle>
                <CardDescription>
                  Depois que o cliente compra, agende um convite automático pra avaliar o produto (com foto/vídeo). As avaliações coletadas entram aqui na sua plataforma.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Ativar régua automática</Label>
                    <p className="text-xs text-muted-foreground">Cria pedidos de avaliação para novas compras.</p>
                  </div>
                  <Switch checked={settings.request_enabled} onCheckedChange={(v) => set("request_enabled", v)} />
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label>Canal</Label>
                    <Select value={settings.request_channel} onValueChange={(v) => set("request_channel", v as "whatsapp" | "email")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                        <SelectItem value="email">E-mail</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Disparar a partir de</Label>
                    <Select value={settings.request_trigger} onValueChange={(v) => set("request_trigger", v as "purchase" | "delivery")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="purchase">Compra confirmada</SelectItem>
                        <SelectItem value="delivery">Entrega</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Mín. de dias após a compra</Label>
                    <Input type="number" min={0} value={settings.request_delay_days} onChange={(e) => set("request_delay_days", Number(e.target.value))} />
                  </div>
                  <div>
                    <Label>Dias após o faturamento/envio</Label>
                    <Input type="number" min={0} value={settings.request_days_after_invoice} onChange={(e) => set("request_days_after_invoice", Number(e.target.value))} />
                  </div>
                  <div>
                    <Label>1º lembrete após (dias)</Label>
                    <Input type="number" min={0} value={settings.request_reminder_days ?? ""} onChange={(e) => set("request_reminder_days", e.target.value === "" ? null : Number(e.target.value))} />
                  </div>
                  <div>
                    <Label>2º lembrete após (dias)</Label>
                    <Input type="number" min={0} value={settings.request_reminder_2_days ?? ""} onChange={(e) => set("request_reminder_2_days", e.target.value === "" ? null : Number(e.target.value))} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">
                  A avaliação é uma <strong>régua de até 3 contatos</strong>: o pedido inicial + 2 lembretes (deixe um vazio para encurtar). Quem avalia sai da sequência automaticamente.
                </p>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Coletar também a avaliação da loja</Label>
                    <p className="text-xs text-muted-foreground">Na mesma página, o cliente avalia o produto e a experiência com a loja (entrega, atendimento).</p>
                  </div>
                  <Switch checked={settings.collect_store_review} onCheckedChange={(v) => set("collect_store_review", v)} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Só pedir após o pedido ser despachado</Label>
                    <p className="text-xs text-muted-foreground">
                      Consulta o pedido na VNDA e só fala com o cliente depois que ele tem <strong>código de rastreio</strong> (= despachado/faturado) — evita pedir avaliação de produto sob demanda que ainda nem saiu. A avaliação é disparada {settings.request_days_after_invoice} dias após o despacho.
                    </p>
                  </div>
                  <Switch checked={settings.request_require_invoice} onCheckedChange={(v) => set("request_require_invoice", v)} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Pedir foto/vídeo</Label>
                    <p className="text-xs text-muted-foreground">Incentiva o cliente a enviar mídia na avaliação.</p>
                  </div>
                  <Switch checked={settings.request_ask_media} onCheckedChange={(v) => set("request_ask_media", v)} />
                </div>
                {/* Mensagens da régua (até 3 contatos) */}
                <div className="rounded-lg border p-4 space-y-3">
                  <div>
                    <Label className="text-sm font-semibold">Mensagens enviadas (já configuradas)</Label>
                    <p className="text-xs text-muted-foreground">
                      A saudação <strong>“Olá {"{nome}"}, tudo bem?”</strong> é adicionada automaticamente. Use <code>{"{produto}"}</code> e <code>{"{link}"}</code>. Edite só se quiser.
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs">1️⃣ Pedido de avaliação</Label>
                    <Textarea value={settings.request_message_template ?? ""} onChange={(e) => set("request_message_template", e.target.value)} rows={3} />
                  </div>
                  <div>
                    <Label className="text-xs">2️⃣ Lembrete (após {settings.request_reminder_days ?? "—"} dias)</Label>
                    <Textarea value={settings.request_reminder_message ?? ""} onChange={(e) => set("request_reminder_message", e.target.value)} rows={2} />
                  </div>
                  <div>
                    <Label className="text-xs">3️⃣ Lembrete final (após +{settings.request_reminder_2_days ?? "—"} dias)</Label>
                    <Textarea value={settings.request_reminder_2_message ?? ""} onChange={(e) => set("request_reminder_2_message", e.target.value)} rows={2} />
                  </div>
                </div>

                {/* Template WhatsApp UTILITY */}
                {settings.request_channel === "whatsapp" && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label>Template WhatsApp (categoria UTILITY)</Label>
                        <p className="text-xs text-muted-foreground">
                          O WhatsApp da régua é enviado <strong>sempre pela API oficial (Meta)</strong> com este template de utilidade. Enquanto a Meta não aprovar, a régua <strong>aguarda</strong> (não dispara por outro canal).
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        {tplStatus?.status ? (
                          <Badge className={`mb-1 ${tplStatus.status === "APPROVED" ? "bg-green-600 hover:bg-green-600" : tplStatus.status === "REJECTED" ? "bg-destructive hover:bg-destructive" : "bg-amber-500 hover:bg-amber-500"}`}>
                            {tplStatus.status === "APPROVED" ? "Aprovado" : tplStatus.status === "REJECTED" ? "Rejeitado" : "Aguardando Meta"}
                          </Badge>
                        ) : settings.wa_template_id ? (
                          <Badge variant="default" className="mb-1">Configurado</Badge>
                        ) : (
                          <Badge variant="secondary" className="mb-1">Não criado</Badge>
                        )}
                        <div className="flex flex-col gap-1">
                          {settings.wa_template_id && (
                            <Button size="sm" variant="outline" onClick={checkTemplateStatus} disabled={checkingTpl}>
                              {checkingTpl ? <Loader2 className="h-4 w-4 animate-spin" /> : <><RefreshCw className="h-3.5 w-3.5 mr-1" /> Consultar status</>}
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={createWaTemplate} disabled={creatingTpl}>
                            {creatingTpl ? <Loader2 className="h-4 w-4 animate-spin" /> : (settings.wa_template_id ? "Recriar template" : "Criar template")}
                          </Button>
                        </div>
                      </div>
                    </div>
                    {tplStatus?.status === "APPROVED" && <div className="text-xs text-green-600">✓ Template aprovado — a régua já pode disparar por WhatsApp.</div>}
                    {tplStatus?.status && tplStatus.status !== "APPROVED" && <div className="text-xs text-amber-600">Template <strong>{tplStatus.status}</strong> na Meta. O WhatsApp da régua aguarda a aprovação.</div>}
                    {tplMsg && <div className="text-xs text-muted-foreground border rounded-md p-2">{tplMsg}</div>}
                  </div>
                )}

                {/* Gamificação / recompensas */}
                <div className="rounded-lg border p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Recompensar avaliações com mídia (cashback)</Label>
                      <p className="text-xs text-muted-foreground">Concede cashback (VNDA) quando a avaliação é aprovada. Foto &lt; vídeo &lt; vídeo aceito p/ ADS.</p>
                    </div>
                    <Switch checked={settings.rewards_enabled} onCheckedChange={(v) => set("rewards_enabled", v)} />
                  </div>
                  {settings.rewards_enabled && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <Label className="text-xs">Foto (R$)</Label>
                        <Input type="number" min={0} step="0.01" value={settings.reward_photo_amount} onChange={(e) => set("reward_photo_amount", Number(e.target.value))} />
                      </div>
                      <div>
                        <Label className="text-xs">Vídeo (R$)</Label>
                        <Input type="number" min={0} step="0.01" value={settings.reward_video_amount} onChange={(e) => set("reward_video_amount", Number(e.target.value))} />
                      </div>
                      <div>
                        <Label className="text-xs">Vídeo + ADS (R$)</Label>
                        <Input type="number" min={0} step="0.01" value={settings.reward_video_ads_amount} onChange={(e) => set("reward_video_ads_amount", Number(e.target.value))} />
                      </div>
                      <div>
                        <Label className="text-xs">Validade (dias)</Label>
                        <Input type="number" min={1} value={settings.reward_validity_days} onChange={(e) => set("reward_validity_days", Number(e.target.value))} />
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Pedir consentimento de uso em ADS (vídeos)</Label>
                      <p className="text-xs text-muted-foreground">Na landing, quem envia vídeo pode autorizar uso em anúncios. Você aprova o vídeo na aba Moderação.</p>
                    </div>
                    <Switch checked={settings.ads_enabled} onCheckedChange={(v) => set("ads_enabled", v)} />
                  </div>
                </div>

                <Button onClick={saveSettings} disabled={savingSettings}>
                  {savingSettings ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : savedSettings ? <Check className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Salvar régua
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---------- Configurações do widget ---------- */}
        <TabsContent value="settings" className="space-y-4">
          {settings && (
            <Card>
              <CardHeader>
                <CardTitle>Widget na loja</CardTitle>
                <CardDescription>Aparência e comportamento do bloco de avaliações injetado na página de produto.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-center justify-between">
                  <Label>Exibir widget na loja</Label>
                  <Switch checked={settings.widget_enabled} onCheckedChange={(v) => set("widget_enabled", v)} />
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label>Cor das estrelas</Label>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={settings.star_color} onChange={(e) => set("star_color", e.target.value)} className="h-9 w-12 rounded border" />
                      <Input value={settings.star_color} onChange={(e) => set("star_color", e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <Label>Avaliações por página</Label>
                    <Input type="number" min={1} max={50} value={settings.reviews_per_page} onChange={(e) => set("reviews_per_page", Number(e.target.value))} />
                  </div>
                </div>
                <div>
                  <Label>Seletor de âncora (CSS, opcional)</Label>
                  <Input value={settings.anchor_selector ?? ""} onChange={(e) => set("anchor_selector", e.target.value || null)} placeholder="#yv-reviews (vazio = detecta automaticamente)" />
                  <p className="text-xs text-muted-foreground mt-1">Onde o widget é inserido. Vazio: reaproveita o ponto da Yourviews ou insere antes do rodapé.</p>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Mostrar selo &quot;Verificado&quot;</Label>
                  <Switch checked={settings.show_verified_badge} onCheckedChange={(v) => set("show_verified_badge", v)} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Mostrar campos (Veste, Tamanho, etc.)</Label>
                  <Switch checked={settings.show_custom_fields} onCheckedChange={(v) => set("show_custom_fields", v)} />
                </div>
                <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                  Toda avaliação coletada (régua pós-compra) entra como <strong>pendente</strong> e só
                  aparece na loja depois de você aprovar na aba <strong>Moderação</strong>. Avaliações
                  só são coletadas de quem comprou o produto.
                </div>
                <Button onClick={saveSettings} disabled={savingSettings}>
                  {savingSettings ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : savedSettings ? <Check className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Salvar configurações
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---------- Instalação ---------- */}
        <TabsContent value="install" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Instalação</CardTitle>
              <CardDescription>
                O widget de avaliações usa o <strong>mesmo script</strong> das prateleiras/cupons/topbar. Se você já instalou o snippet, não precisa fazer nada — o bloco aparece automaticamente nas páginas de produto.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {apiKey ? (
                <>
                  <p className="text-sm text-muted-foreground">Caso ainda não tenha instalado, cole este snippet no GTM (ou antes de <code>&lt;/head&gt;</code>):</p>
                  <pre className="bg-muted rounded-lg p-4 text-xs overflow-auto">
{`<script>
  var _shelvesKey = "${apiKey}";
  var _shelvesBase = "${typeof window !== "undefined" ? window.location.origin : "https://dash.bulking.com.br"}";
  (function(){var s=document.createElement('script');s.async=true;
  s.src=_shelvesBase+'/shelves.js';document.head.appendChild(s)})();
</script>`}
                  </pre>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhuma API key encontrada. Gere uma na página de <strong>Prateleiras → Instalação</strong> (a mesma chave serve para avaliações).
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
