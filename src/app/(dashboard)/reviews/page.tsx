"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
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
  Sparkles,
  Film,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/ui/callout";
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
  form_fields: { key: string; label: string; type: string; options: string[] }[];
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
  const [storeStatusFilter, setStoreStatusFilter] = useState("all");
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
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // Install
  const [apiKey, setApiKey] = useState<string | null>(null);

  // Geração com IA
  const [aiProducts, setAiProducts] = useState<{ product_id: string; name: string | null; review_count: number }[]>([]);
  const [aiProduct, setAiProduct] = useState("");
  const [aiCount, setAiCount] = useState(5);
  const [aiAutoPublish, setAiAutoPublish] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [aiProductsLoaded, setAiProductsLoaded] = useState(false);

  const loadAiProducts = useCallback(async () => {
    if (!workspace?.id) return;
    const d = await fetch("/api/reviews/products", { headers: headers() }).then((r) => r.json());
    setAiProducts(d.products || []);
    setAiProductsLoaded(true);
  }, [workspace?.id, headers]);

  // Galeria de mídias (fotos/vídeos dos clientes) — curadoria p/ ADS + download.
  type MediaItem = {
    review_id: string; index: number; url: string; type: "image" | "video";
    product_id: string | null; product_name: string | null; author_name: string | null;
    rating: number; review_status: string; body: string | null;
    custom_fields?: { name: string; values: string[] }[];
    ads_consent: boolean; ads_status: string; reward_status: string; created_at: string;
  };
  type MediaSummary = { total_with_media: number; ads_pending: number; ads_accepted: number };
  const GALLERY_PAGE = 24;
  const [galleryItems, setGalleryItems] = useState<MediaItem[]>([]);
  const [gallerySummary, setGallerySummary] = useState<MediaSummary | null>(null);
  const [galleryType, setGalleryType] = useState<"all" | "video" | "photo">("all");
  const [galleryAds, setGalleryAds] = useState<"all" | "consent" | "accepted">("all");
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryMore, setGalleryMore] = useState(false);
  const [galleryOffset, setGalleryOffset] = useState(0);
  const [galleryHasMore, setGalleryHasMore] = useState(false);
  const [lightbox, setLightbox] = useState<MediaItem | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const galleryQuery = useCallback((offset: number) => {
    const params = new URLSearchParams();
    if (galleryType !== "all") params.set("type", galleryType);
    if (galleryAds !== "all") params.set("ads", galleryAds);
    params.set("offset", String(offset));
    params.set("limit", String(GALLERY_PAGE));
    return params.toString();
  }, [galleryType, galleryAds]);

  const loadGallery = useCallback(async () => {
    if (!workspace?.id) return;
    setGalleryLoading(true);
    try {
      const d = await fetch(`/api/reviews/media?${galleryQuery(0)}`, { headers: headers() }).then((r) => r.json());
      setGalleryItems(d.items || []);
      setGallerySummary(d.summary || null);
      setGalleryOffset(d.next_offset || 0);
      setGalleryHasMore(!!d.has_more);
    } finally {
      setGalleryLoading(false);
    }
  }, [workspace?.id, headers, galleryQuery]);

  const loadMoreGallery = useCallback(async () => {
    if (!workspace?.id || galleryMore || galleryLoading || !galleryHasMore) return;
    setGalleryMore(true);
    try {
      const d = await fetch(`/api/reviews/media?${galleryQuery(galleryOffset)}`, { headers: headers() }).then((r) => r.json());
      setGalleryItems((prev) => [...prev, ...(d.items || [])]);
      setGalleryOffset(d.next_offset || galleryOffset);
      setGalleryHasMore(!!d.has_more);
    } finally {
      setGalleryMore(false);
    }
  }, [workspace?.id, headers, galleryQuery, galleryOffset, galleryMore, galleryLoading, galleryHasMore]);

  function downloadUrl(m: MediaItem) {
    return `/api/reviews/media/download?review_id=${m.review_id}&i=${m.index}&workspace_id=${workspace?.id || ""}`;
  }

  function mediaItemFromReview(r: Review, media: { url: string; type: string }, index: number): MediaItem {
    return {
      review_id: r.id,
      index,
      url: media.url,
      type: media.type === "video" ? "video" : "image",
      product_id: r.product_id,
      product_name: r.product_name,
      author_name: r.author_name,
      rating: r.rating,
      review_status: r.status,
      body: r.body,
      custom_fields: r.custom_fields || [],
      ads_consent: !!r.ads_consent,
      ads_status: r.ads_status || "",
      reward_status: r.reward_status || "",
      created_at: r.reviewed_at || r.created_at,
    };
  }

  async function generateAi() {
    if (!workspace?.id || !aiProduct) return;
    setAiGenerating(true);
    setAiMsg(null);
    try {
      const res = await fetch("/api/reviews/ai-generate", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ product_id: aiProduct, count: aiCount, auto_publish: aiAutoPublish }),
      });
      const d = await res.json();
      if (d.ok) {
        setAiMsg(`✓ ${d.inserted} avaliação(ões) geradas para "${d.product_name}" — ${aiAutoPublish ? "publicadas" : "aguardando moderação"}.`);
        loadList();
        loadStats();
        loadAiProducts();
      } else {
        setAiMsg(d.error || "Erro ao gerar avaliações.");
      }
    } catch {
      setAiMsg("Erro de conexão.");
    } finally {
      setAiGenerating(false);
    }
  }

  // Store reviews (avaliações da loja)
  const [storeReviews, setStoreReviews] = useState<{ id: string; rating: number; comment: string | null; author_name: string | null; status: string; order_code: string | null; created_at: string }[]>([]);
  const [storeSummary, setStoreSummary] = useState<{ average: number; published: number } | null>(null);
  const [storeTotal, setStoreTotal] = useState(0);

  const loadStore = useCallback(async () => {
    if (!workspace?.id) return;
    const params = new URLSearchParams({ limit: "100" });
    if (storeStatusFilter !== "all") params.set("status", storeStatusFilter);
    const d = await fetch(`/api/reviews/store?${params.toString()}`, { headers: headers() }).then((r) => r.json());
    setStoreReviews(d.reviews || []);
    setStoreTotal(d.total || 0);
    setStoreSummary(d.summary || null);
  }, [workspace?.id, headers, storeStatusFilter]);

  async function moderateStore(id: string, status: string) {
    await fetch(`/api/reviews/store/${id}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ status }) });
    loadStore();
  }

  // Métricas
  type Metrics = {
    product: { total: number; published: number; pending: number; average: number; distribution: Record<string, number>; nps: { nps: number; promoters: number; passives: number; detractors: number }; by_source: Record<string, number> };
    funnel: { created: number; contacted: number; completed: number; conversion_rate: number; by_status: Record<string, number> };
    store: { total: number; published: number; average: number; nps: { nps: number } };
    rewards: { granted_count: number; total_amount: number; ads_pending: number; ads_accepted: number };
    media: { with_photo: number; with_video: number; pct_with_media: number };
  };
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const loadMetrics = useCallback(async () => {
    if (!workspace?.id) return;
    const d = await fetch("/api/reviews/metrics", { headers: headers() }).then((r) => r.json());
    if (!d.error) setMetrics(d);
  }, [workspace?.id, headers]);

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
      loadMetrics();
      loadConnection();
      loadSettings();
      loadKey();
    }
  }, [workspace?.id, loadStats, loadList, loadMetrics, loadConnection, loadSettings, loadKey]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextTab = params.get("tab");
    const nextStatus = params.get("status");
    if (
      nextTab &&
      ["moderation", "metrics", "gallery", "store", "ai", "import", "ruler", "settings", "install"].includes(nextTab)
    ) {
      setTab(nextTab);
    }
    if (nextStatus && ["all", "published", "pending", "hidden", "rejected"].includes(nextStatus)) {
      if (nextTab === "store") setStoreStatusFilter(nextStatus);
      else setStatusFilter(nextStatus);
    }
  }, []);

  useEffect(() => {
    if (workspace?.id) loadList();
  }, [statusFilter, loadList, workspace?.id]);

  useEffect(() => {
    if (workspace?.id) loadStore();
  }, [storeStatusFilter, loadStore, workspace?.id]);

  useEffect(() => {
    if (tab === "ai" && workspace?.id && !aiProductsLoaded) loadAiProducts();
  }, [tab, workspace?.id, aiProductsLoaded, loadAiProducts]);

  useEffect(() => {
    if (tab === "gallery" && workspace?.id) loadGallery();
  }, [tab, workspace?.id, loadGallery]);

  // Infinite scroll da galeria: observa o sentinel no fim da grade.
  useEffect(() => {
    if (tab !== "gallery") return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMoreGallery();
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [tab, loadMoreGallery]);

  async function moderate(id: string, status: string) {
    await fetch(`/api/reviews/${id}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ status }) });
    loadList();
    loadStats();
  }

  // Aprova um vídeo decidindo, no mesmo ato, se serve para ADS (define o valor
  // único do cashback). useAds=true → valor de ADS; false → valor de vídeo.
  async function approveWithAds(id: string, useAds: boolean) {
    await fetch(`/api/reviews/${id}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ status: "published", ads_status: useAds ? "accepted" : "rejected" }) });
    loadList();
    loadStats();
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
    setSettingsError(null);
    try {
      const res = await fetch("/api/reviews/settings", { method: "PATCH", headers: headers(), body: JSON.stringify(settings) });
      const d = await res.json();
      if (!res.ok || d.error) {
        setSettingsError(d.error || "Erro ao salvar configurações.");
        return;
      }
      if (!d.settings) {
        setSettingsError("A API não retornou as configurações salvas.");
        return;
      }
      setSettings(d.settings);
      setSavedSettings(true);
      setTimeout(() => setSavedSettings(false), 2500);
    } catch {
      setSettingsError("Erro de conexão ao salvar configurações.");
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
          <TabsTrigger value="metrics">Métricas</TabsTrigger>
          <TabsTrigger value="gallery">
            <Film className="h-3.5 w-3.5 mr-1" />
            Galeria de mídias
          </TabsTrigger>
          <TabsTrigger value="store">
            Avaliações da loja
            {storeSummary && storeSummary.published > 0 && (
              <span className="ml-1.5 text-[10px] text-muted-foreground">★ {storeSummary.average}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="ai">
            <Sparkles className="h-3.5 w-3.5 mr-1 text-amber-500" />
            Gerar com IA
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
                      {r.status === "pending" && r.media_kind === "video" && r.ads_status === "pending" && (
                        <div className="mt-2 rounded-md bg-purple-50 border border-purple-200 px-3 py-2">
                          <p className="text-xs text-purple-800 mb-2">
                            O cliente autorizou usar o vídeo em anúncios. <strong>Você decide se este vídeo serve</strong> — isso define o cashback (sem somar):
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" className="h-7 bg-purple-600 hover:bg-purple-700 text-white" onClick={() => approveWithAds(r.id, true)}>
                              ✓ Serve p/ ADS — aprovar{settings ? ` (R$ ${settings.reward_video_ads_amount})` : ""}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7" onClick={() => approveWithAds(r.id, false)}>
                              Não serve — aprovar{settings ? ` (R$ ${settings.reward_video_amount})` : ""}
                            </Button>
                          </div>
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
                        <div className="mt-2">
                          <div className="flex flex-wrap gap-2">
                            {r.media.map((m, i) => {
                              const item = mediaItemFromReview(r, m, i);
                              return (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => setLightbox(item)}
                                  className="group relative h-16 w-16 overflow-hidden rounded-md border bg-black/5 focus:outline-none focus:ring-2 focus:ring-primary/40"
                                  title="Clique para ampliar a mídia e ver detalhes da avaliação"
                                >
                                  {item.type === "video" ? (
                                    <>
                                      <video src={item.url} className="h-full w-full object-cover bg-black" muted preload="metadata" />
                                      <span className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/25 transition-colors">
                                        <span className="h-7 w-7 rounded-full bg-black/60 text-white flex items-center justify-center text-[11px]">▶</span>
                                      </span>
                                    </>
                                  ) : (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={item.url} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                                  )}
                                  <span className="absolute bottom-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Eye className="h-3 w-3" />
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">Clique na mídia para ampliar e revisar os detalhes.</p>
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
                      {/* Vídeo com consentimento de ADS é aprovado pelos 2 botões acima (decisão de ADS). */}
                      {r.status === "pending" && !(r.media_kind === "video" && r.ads_status === "pending") ? (
                        <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => moderate(r.id, "published")} title="Aprovar e publicar">
                          <CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar
                        </Button>
                      ) : r.status !== "published" && r.status !== "pending" && (
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

        {/* ---------- Métricas ---------- */}
        <TabsContent value="metrics" className="space-y-4">
          {!metrics ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></CardContent></Card>
          ) : (
            <>
              {/* KPIs principais */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card><CardContent className="pt-6">
                  <div className="text-3xl font-bold">{metrics.product.nps.nps}</div>
                  <div className="text-xs text-muted-foreground mt-1">NPS (estimado pelas notas)</div>
                </CardContent></Card>
                <Card><CardContent className="pt-6">
                  <div className="text-3xl font-bold flex items-center gap-2">{metrics.product.average.toFixed(1)}<Stars n={Math.round(metrics.product.average)} size={15} /></div>
                  <div className="text-xs text-muted-foreground mt-1">Nota média (produto)</div>
                </CardContent></Card>
                <Card><CardContent className="pt-6">
                  <div className="text-3xl font-bold">{metrics.funnel.conversion_rate}%</div>
                  <div className="text-xs text-muted-foreground mt-1">Conversão da régua</div>
                </CardContent></Card>
                <Card><CardContent className="pt-6">
                  <div className="text-3xl font-bold">{metrics.product.published}</div>
                  <div className="text-xs text-muted-foreground mt-1">Avaliações publicadas</div>
                </CardContent></Card>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                {/* Distribuição de notas */}
                <Card>
                  <CardHeader><CardTitle className="text-base">Distribuição de notas</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {[5, 4, 3, 2, 1].map((star) => {
                      const n = metrics.product.distribution[String(star)] || 0;
                      const tot = Object.values(metrics.product.distribution).reduce((a, b) => a + b, 0) || 1;
                      const pct = Math.round((n / tot) * 100);
                      return (
                        <div key={star} className="flex items-center gap-2 text-sm">
                          <span className="w-3">{star}</span>
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-amber-400" style={{ width: `${pct}%` }} /></div>
                          <span className="w-12 text-right text-muted-foreground">{n} ({pct}%)</span>
                        </div>
                      );
                    })}
                    <div className="text-xs text-muted-foreground pt-1">
                      Promotores {metrics.product.nps.promoters} · Neutros {metrics.product.nps.passives} · Detratores {metrics.product.nps.detractors}
                    </div>
                  </CardContent>
                </Card>

                {/* Funil da régua */}
                <Card>
                  <CardHeader><CardTitle className="text-base">Funil da régua</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Pedidos criados</span><b>{metrics.funnel.created}</b></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Contatados</span><b>{metrics.funnel.contacted}</b></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Avaliaram (concluídos)</span><b>{metrics.funnel.completed}</b></div>
                    <div className="flex justify-between border-t pt-2"><span className="text-muted-foreground">Taxa de conversão</span><b className="text-green-600">{metrics.funnel.conversion_rate}%</b></div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2 text-xs text-muted-foreground">
                      {Object.entries(metrics.funnel.by_status).map(([k, v]) => <span key={k}>{k}: {v}</span>)}
                    </div>
                  </CardContent>
                </Card>

                {/* Recompensas + mídia */}
                <Card>
                  <CardHeader><CardTitle className="text-base">Recompensas & mídia</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Cashback concedido</span><b>R$ {metrics.rewards.total_amount} ({metrics.rewards.granted_count})</b></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Avaliações com mídia</span><b>{metrics.media.pct_with_media}%</b></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Fotos / Vídeos</span><b>{metrics.media.with_photo} / {metrics.media.with_video}</b></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Vídeos p/ ADS (aguardando / aceitos)</span><b>{metrics.rewards.ads_pending} / {metrics.rewards.ads_accepted}</b></div>
                  </CardContent>
                </Card>

                {/* Loja */}
                <Card>
                  <CardHeader><CardTitle className="text-base">Avaliação da loja</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Nota média (loja)</span><b className="flex items-center gap-1">{metrics.store.average.toFixed(1)} <Stars n={Math.round(metrics.store.average)} size={13} /></b></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">NPS da loja</span><b>{metrics.store.nps.nps}</b></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Avaliações da loja</span><b>{metrics.store.published} publicadas / {metrics.store.total}</b></div>
                    <div className="flex flex-wrap gap-x-3 pt-2 text-xs text-muted-foreground">
                      {Object.entries(metrics.product.by_source).map(([k, v]) => <span key={k}>{k}: {v}</span>)}
                    </div>
                  </CardContent>
                </Card>
              </div>
              <p className="text-xs text-muted-foreground">O NPS é estimado pelas notas (5★ = promotor, 4★ = neutro, ≤3★ = detrator), já que coletamos nota de 1 a 5.</p>
            </>
          )}
        </TabsContent>

        {/* ---------- Galeria de mídias ---------- */}
        <TabsContent value="gallery" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={galleryType} onValueChange={(v) => setGalleryType(v as "all" | "video" | "photo")}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Fotos e vídeos</SelectItem>
                <SelectItem value="video">Só vídeos</SelectItem>
                <SelectItem value="photo">Só fotos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={galleryAds} onValueChange={(v) => setGalleryAds(v as "all" | "consent" | "accepted")}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Qualquer ADS</SelectItem>
                <SelectItem value="consent">Com consentimento de ADS</SelectItem>
                <SelectItem value="accepted">Aceitos p/ ADS</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="border-purple-300 text-purple-700 hover:bg-purple-50"
              onClick={() => { setGalleryType("video"); setGalleryAds("consent"); }}
            >
              🎬 Vídeos p/ ADS
            </Button>
            <Button variant="outline" size="sm" onClick={loadGallery} disabled={galleryLoading}>
              {galleryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            {gallerySummary && (
              <span className="text-xs text-muted-foreground ml-auto">
                {gallerySummary.total_with_media} avaliações com mídia · {gallerySummary.ads_accepted} aceitos p/ ADS · {gallerySummary.ads_pending} a revisar
              </span>
            )}
          </div>

          {galleryItems.length === 0 && galleryLoading ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></CardContent></Card>
          ) : galleryItems.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhuma mídia encontrada com esses filtros. As mídias aparecem aqui conforme os clientes avaliam com foto/vídeo.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {galleryItems.map((m) => (
                <div key={`${m.review_id}-${m.index}`} className="rounded-xl overflow-hidden border bg-card flex flex-col">
                  <button type="button" onClick={() => setLightbox(m)} className="relative block w-full bg-black/5">
                    {m.type === "video" ? (
                      <>
                        <video src={m.url} className="w-full aspect-square object-cover bg-black" muted preload="metadata" />
                        <span className="absolute inset-0 flex items-center justify-center">
                          <span className="h-10 w-10 rounded-full bg-black/55 text-white flex items-center justify-center">▶</span>
                        </span>
                      </>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.url} alt="" className="w-full aspect-square object-cover" />
                    )}
                  </button>
                  <div className="p-2.5 space-y-1.5 flex-1 flex flex-col">
                    <div className="flex items-center justify-between gap-1">
                      <Stars n={m.rating} size={11} />
                      {m.type === "video" && <Film className="h-3.5 w-3.5 text-muted-foreground" />}
                    </div>
                    <div className="text-xs font-medium truncate" title={m.product_name || ""}>{m.product_name || "—"}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{m.author_name || "Cliente"}</div>
                    <div className="flex flex-wrap gap-1">
                      {m.type === "video" && m.ads_status === "accepted" && <Badge className="text-[10px] bg-green-600 hover:bg-green-600">ADS ✓</Badge>}
                      {m.type === "video" && m.ads_status === "pending" && <Badge className="text-[10px] bg-purple-600 hover:bg-purple-600">ADS: revisar</Badge>}
                      {m.type === "video" && m.ads_consent && m.ads_status !== "accepted" && m.ads_status !== "pending" && <Badge variant="outline" className="text-[10px]">autorizou ADS</Badge>}
                      <Badge variant={STATUS_LABELS[m.review_status]?.variant || "secondary"} className="text-[10px]">{STATUS_LABELS[m.review_status]?.label || m.review_status}</Badge>
                    </div>
                    <div className="mt-auto flex gap-1.5 pt-1">
                      <a href={downloadUrl(m)} download className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs hover:bg-muted">
                        <Download className="h-3.5 w-3.5" /> Baixar
                      </a>
                      <button type="button" onClick={() => setLightbox(m)} className="inline-flex items-center justify-center rounded-md border px-2 py-1.5 text-xs hover:bg-muted">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Sentinel do infinite scroll — carrega mais ao chegar perto do fim */}
          {galleryHasMore && (
            <div ref={sentinelRef} className="h-12 flex items-center justify-center">
              {galleryMore && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Cada mídia está vinculada à avaliação que a originou — clique para ver a avaliação completa. Use “Vídeos p/ ADS” para curar os vídeos autorizados pelos clientes. Ordenado por mais recentes.</p>
        </TabsContent>

        {/* ---------- Avaliações da loja ---------- */}
        <TabsContent value="store" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Avaliações da <strong>experiência com a loja</strong> (entrega, atendimento), coletadas na mesma página da avaliação do produto — mas separadas dela.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={storeStatusFilter} onValueChange={setStoreStatusFilter}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="published">Publicadas</SelectItem>
                <SelectItem value="pending">Pendentes</SelectItem>
                <SelectItem value="hidden">Ocultas</SelectItem>
                <SelectItem value="rejected">Rejeitadas</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {storeTotal} avaliação(ões)
            </span>
          </div>
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

        {/* ---------- Gerar com IA ---------- */}
        <TabsContent value="ai" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-amber-500" /> Gerar avaliações com IA</CardTitle>
              <CardDescription>
                Gera avaliações no <strong>mesmo tom das suas avaliações reais</strong> (aprende com o que já está no banco) e com os campos estruturados do formulário (tamanho, caimento, tipo de corpo…). Útil para produtos novos, sem histórico, melhorando a conversão. Entram como <strong>pendentes</strong> para você revisar antes de publicar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Produto</Label>
                  <Select value={aiProduct} onValueChange={setAiProduct}>
                    <SelectTrigger>
                      <SelectValue placeholder={aiProductsLoaded ? "Selecione um produto" : "Carregando produtos…"} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {aiProducts.map((p) => (
                        <SelectItem key={p.product_id} value={p.product_id}>
                          {p.name || p.product_id} {p.review_count > 0 ? `· ${p.review_count} aval.` : "· sem avaliações"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">Produtos com menos avaliações aparecem primeiro.</p>
                </div>
                <div>
                  <Label>Quantidade (máx. 15)</Label>
                  <Input type="number" min={1} max={15} value={aiCount} onChange={(e) => setAiCount(Math.min(15, Math.max(1, Number(e.target.value))))} />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label>Publicar automaticamente</Label>
                  <p className="text-xs text-muted-foreground">Desligado (recomendado): entram como pendentes para você revisar na aba Moderação.</p>
                </div>
                <Switch checked={aiAutoPublish} onCheckedChange={setAiAutoPublish} />
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={generateAi} disabled={aiGenerating || !aiProduct}>
                  {aiGenerating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  Gerar {aiCount} avaliações
                </Button>
                {aiGenerating && <span className="text-xs text-muted-foreground">A IA pode levar alguns segundos…</span>}
              </div>
              {aiMsg && <div className="text-sm border rounded-md p-3">{aiMsg}</div>}
              <Callout tone="amber">
                As avaliações geradas são marcadas como <code>source: ai</code> internamente. Revise antes de publicar — você pode editar, aprovar ou excluir cada uma na aba Moderação.
              </Callout>
            </CardContent>
          </Card>
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

                {/* Campos do formulário (tamanho, caimento, tipo de corpo, etc.) */}
                <div className="rounded-lg border p-4 space-y-3">
                  <div>
                    <Label className="text-sm font-semibold">Campos do formulário</Label>
                    <p className="text-xs text-muted-foreground">O cliente seleciona (tamanho, caimento, tipo de corpo…) e isso aparece na avaliação, ajudando outros a decidir. Opções separadas por vírgula.</p>
                  </div>
                  {(settings.form_fields || []).map((f, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <Input
                        className="w-44 shrink-0"
                        placeholder="Pergunta (ex.: Tamanho)"
                        value={f.label}
                        onChange={(e) => {
                          const ff = [...settings.form_fields];
                          ff[i] = { ...ff[i], label: e.target.value, key: ff[i].key || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_") };
                          set("form_fields", ff);
                        }}
                      />
                      <Input
                        className="flex-1"
                        placeholder="Opções separadas por vírgula"
                        value={(f.options || []).join(", ")}
                        onChange={(e) => {
                          const ff = [...settings.form_fields];
                          ff[i] = { ...ff[i], type: "select", options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) };
                          set("form_fields", ff);
                        }}
                      />
                      <Button size="sm" variant="outline" className="text-destructive shrink-0" onClick={() => set("form_fields", settings.form_fields.filter((_, idx) => idx !== i))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => set("form_fields", [...(settings.form_fields || []), { key: `campo_${(settings.form_fields || []).length + 1}`, label: "", type: "select", options: [] }])}>
                    + Adicionar campo
                  </Button>
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

                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={saveSettings} disabled={savingSettings}>
                    {savingSettings ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : savedSettings ? <Check className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                    Salvar régua
                  </Button>
                  {savedSettings && !settingsError && <span className="text-xs text-green-600">Configurações salvas.</span>}
                  {settingsError && <span className="text-xs text-destructive">{settingsError}</span>}
                </div>
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
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={saveSettings} disabled={savingSettings}>
                    {savingSettings ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : savedSettings ? <Check className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                    Salvar configurações
                  </Button>
                  {savedSettings && !settingsError && <span className="text-xs text-green-600">Configurações salvas.</span>}
                  {settingsError && <span className="text-xs text-destructive">{settingsError}</span>}
                </div>
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

      {/* Lightbox da galeria — mídia grande + avaliação vinculada */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <div className="bg-card rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="relative bg-black flex items-center justify-center">
              {lightbox.type === "video" ? (
                <video src={lightbox.url} controls autoPlay className="max-h-[60vh] w-full object-contain bg-black" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={lightbox.url} alt="" className="max-h-[60vh] w-full object-contain bg-black" />
              )}
              <button type="button" onClick={() => setLightbox(null)} className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/60 text-white flex items-center justify-center">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Stars n={lightbox.rating} />
                <span className="font-semibold text-sm">{lightbox.author_name || "Cliente"}</span>
                <Badge variant={STATUS_LABELS[lightbox.review_status]?.variant || "secondary"} className="text-[10px]">{STATUS_LABELS[lightbox.review_status]?.label || lightbox.review_status}</Badge>
                {lightbox.type === "video" && lightbox.ads_status === "accepted" && <Badge className="text-[10px] bg-green-600 hover:bg-green-600">ADS ✓</Badge>}
                {lightbox.type === "video" && lightbox.ads_status === "pending" && <Badge className="text-[10px] bg-purple-600 hover:bg-purple-600">ADS: revisar</Badge>}
                {lightbox.type === "video" && lightbox.ads_consent && lightbox.ads_status !== "accepted" && lightbox.ads_status !== "pending" && <Badge variant="outline" className="text-[10px]">autorizou ADS</Badge>}
              </div>
              {lightbox.product_name && <div className="text-xs text-muted-foreground">Produto: {lightbox.product_name}{lightbox.product_id ? ` (${lightbox.product_id})` : ""}</div>}
              {lightbox.body && <p className="text-sm text-muted-foreground whitespace-pre-line">{lightbox.body}</p>}
              {lightbox.custom_fields && lightbox.custom_fields.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-muted/60 p-3">
                  {lightbox.custom_fields.map((f, i) => (
                    <span key={i} className="text-xs text-muted-foreground">
                      {f.name}: <span className="text-foreground font-medium">{f.values.join(", ")}</span>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <a href={downloadUrl(lightbox)} download className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm hover:opacity-90">
                  <Download className="h-4 w-4" /> Baixar mídia
                </a>
                <a href={lightbox.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                  Abrir em nova aba
                </a>
                <button type="button" onClick={() => { setTab("moderation"); setStatusFilter("all"); setSearch(lightbox.author_name || ""); setLightbox(null); }} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                  <MessageSquareReply className="h-4 w-4" /> Moderar avaliação
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
