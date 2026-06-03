"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Instagram,
  Users,
  TrendingUp,
  TrendingDown,
  Heart,
  MessageCircle,
  RefreshCw,
  Loader2,
  Sparkles,
  ExternalLink,
  Image as ImageIcon,
  Video,
  Images,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";
import { useChartTheme } from "@/hooks/use-chart-theme";

// ---------- tipos ----------

interface SeriesPoint {
  date: string;
  label: string;
  followers: number;
  following: number;
  posts: number;
  avgLikes: number | null;
  avgComments: number | null;
  engagementRate: number | null;
  dailyDelta: number | null;
}

interface DeltaValue {
  value: number;
  pct: number | null;
}

interface SnapshotsResponse {
  username: string | null;
  profile: {
    username: string;
    fullName: string | null;
    profilePicUrl: string | null;
    biography: string | null;
    externalUrl: string | null;
    followersCount: number;
    followingCount: number;
    postsCount: number;
    lastScrapedAt: string | null;
  } | null;
  hasData: boolean;
  configured: boolean;
  series: SeriesPoint[];
  current: SeriesPoint | null;
  deltas: {
    d1: DeltaValue | null;
    d7: DeltaValue | null;
    d30: DeltaValue | null;
    periodNet: number;
    periodPct: number | null;
    periodDays: number;
    avgDailyGrowth: number | null;
  } | null;
  engagement: {
    current: number | null;
    ref30d: number | null;
    deltaPct: number | null;
    avgLikes: number | null;
    avgComments: number | null;
  } | null;
}

interface IGPost {
  id: string;
  shortCode: string;
  url: string;
  type: "Image" | "Video" | "Sidecar";
  timestamp: string;
  caption: string;
  likesCount: number;
  commentsCount: number;
  displayUrl: string;
}

const RANGES = [
  { days: 30, label: "30 dias" },
  { days: 90, label: "90 dias" },
  { days: 180, label: "6 meses" },
  { days: 365, label: "1 ano" },
];

// ---------- helpers ----------

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${formatNumber(n)}`;
}

function signedPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "há poucos minutos";
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d} dia${d > 1 ? "s" : ""}`;
}

// ---------- pequenos componentes ----------

function ProfileAvatar({ url, name }: { url: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-amber-500 via-pink-500 to-purple-600 text-lg font-bold text-white">
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-pink-500/30"
      onError={() => setBroken(true)}
    />
  );
}

function DeltaCard({
  title,
  delta,
  hint,
}: {
  title: string;
  delta: DeltaValue | null;
  hint?: string;
}) {
  const up = (delta?.value ?? 0) >= 0;
  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {delta ? (
          <>
            <div className="mt-3 flex items-baseline gap-2">
              <span
                className={`text-2xl font-bold tabular-nums ${up ? "text-success" : "text-destructive"}`}
              >
                {signed(delta.value)}
              </span>
              {up ? (
                <TrendingUp className="h-4 w-4 text-success" />
              ) : (
                <TrendingDown className="h-4 w-4 text-destructive" />
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {signedPct(delta.pct)} no período
            </p>
          </>
        ) : (
          <>
            <p className="mt-3 text-2xl font-bold tabular-nums text-muted-foreground">—</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {hint || "precisa de mais histórico"}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PostTypeIcon({ type }: { type: IGPost["type"] }) {
  if (type === "Video") return <Video className="h-3 w-3" />;
  if (type === "Sidecar") return <Images className="h-3 w-3" />;
  return <ImageIcon className="h-3 w-3" />;
}

function FollowerVerdict({
  deltas,
}: {
  deltas: NonNullable<SnapshotsResponse["deltas"]>;
}) {
  // Prioriza a janela de 7 dias; cai pro acumulado do período se faltar.
  const use7 = deltas.d7 != null;
  const value = use7 ? deltas.d7!.value : deltas.periodNet;
  const pct = use7 ? deltas.d7!.pct : deltas.periodPct;
  const ref = use7 ? "nos últimos 7 dias" : `em ${deltas.periodDays} dias`;
  const up = value > 0;
  const down = value < 0;
  const tone = up
    ? "border-success/30 bg-success/10 text-success"
    : down
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : "border-border bg-muted text-muted-foreground";
  const Icon = up ? TrendingUp : down ? TrendingDown : Users;
  const word = up ? "Crescendo" : down ? "Caindo" : "Estável";
  return (
    <div className={`flex items-center gap-4 rounded-xl border p-5 ${tone}`}>
      <Icon className="h-9 w-9 shrink-0" />
      <div>
        <p className="text-xl font-bold leading-tight">{word}</p>
        <p className="text-sm opacity-90">
          {`${signed(value)} seguidores (${signedPct(pct)}) ${ref}`}
        </p>
      </div>
    </div>
  );
}

// ---------- página ----------

export default function InstagramPage() {
  const { workspace } = useWorkspace();
  const chart = useChartTheme();

  const [data, setData] = useState<SnapshotsResponse | null>(null);
  const [posts, setPosts] = useState<IGPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(90);
  const [usernameInput, setUsernameInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const headers = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = {};
    if (workspace?.id) h["x-workspace-id"] = workspace.id;
    return h;
  }, [workspace?.id]);

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/instagram/snapshots?days=${days}`, {
        headers,
        signal: controller.signal,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Erro ${res.status}`);
      }
      const json = (await res.json()) as SnapshotsResponse;
      setData(json);

      if (json.username) {
        // Top posts (cache de 6h ou scrape sob demanda no backend).
        fetch(`/api/instagram/posts?username=${encodeURIComponent(json.username)}&limit=30`, {
          headers,
          signal: controller.signal,
        })
          .then((r) => (r.ok ? r.json() : { posts: [] }))
          .then((d) => setPosts((d.posts as IGPost[]) || []))
          .catch(() => {});
      } else {
        setPosts([]);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  }, [days, headers]);

  useEffect(() => {
    if (workspace?.id) fetchData();
    return () => abortRef.current?.abort();
  }, [fetchData, workspace?.id]);

  const handleCapture = useCallback(
    async (username?: string) => {
      setRefreshing(true);
      setError(null);
      try {
        const res = await fetch("/api/instagram/snapshot", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(username ? { username } : {}),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `Erro ${res.status}`);
        }
        await fetchData();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao capturar snapshot");
      } finally {
        setRefreshing(false);
      }
    },
    [headers, fetchData]
  );

  const topPosts = useMemo(
    () =>
      [...posts]
        .sort((a, b) => b.likesCount + b.commentsCount - (a.likesCount + a.commentsCount))
        .slice(0, 8),
    [posts]
  );

  const profile = data?.profile;
  const current = data?.current;
  const deltas = data?.deltas;
  const engagement = data?.engagement;

  // ----- estado: ainda carregando o primeiro fetch -----
  const initialLoading = loading && !data;

  // ----- estado: nenhum perfil cadastrado -----
  const notConfigured = !initialLoading && data && !data.username;

  // ----- estado: perfil cadastrado mas sem histórico -----
  const noHistory = !initialLoading && data?.username && !data.hasData;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Instagram className="h-7 w-7 text-pink-500" />
          <div>
            <h1 className="text-2xl font-bold">Instagram</h1>
            <p className="text-sm text-muted-foreground">
              Crescimento de seguidores e engajamento do perfil
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  days === r.days
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {data?.username && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleCapture()}
              disabled={refreshing}
              className="gap-1.5"
            >
              {refreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Atualizar agora
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Loading inicial */}
      {initialLoading && (
        <div className="space-y-6">
          <Skeleton className="h-24 w-full" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
          <Skeleton className="h-[320px] w-full" />
        </div>
      )}

      {/* Não configurado: pedir @username */}
      {notConfigured && (
        <Card>
          <CardContent className="space-y-4 py-10 text-center">
            <Instagram className="mx-auto h-10 w-10 text-pink-500" />
            <div>
              <p className="font-medium">Nenhum perfil do Instagram monitorado</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Informe o @username do perfil para começar a medir crescimento e engajamento.
              </p>
            </div>
            <div className="mx-auto flex max-w-sm items-center gap-2">
              <Input
                placeholder="@bulkingoficial"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
              />
              <Button
                onClick={() => handleCapture(usernameInput.trim().replace(/^@/, ""))}
                disabled={refreshing || !usernameInput.trim()}
                className="gap-1.5 whitespace-nowrap"
              >
                {refreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Monitorar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              A primeira captura pode levar até 1 minuto.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Configurado, sem histórico ainda */}
      {noHistory && (
        <>
          <ProfileHeader profile={profile!} />
          <Card>
            <CardContent className="space-y-4 py-10 text-center">
              <Sparkles className="mx-auto h-10 w-10 text-pink-500" />
              <div>
                <p className="font-medium">Ainda não há histórico para gráficos</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Capture o primeiro ponto agora. O crescimento aparece a partir do 2º dia —
                  depois disso o snapshot diário roda sozinho.
                </p>
              </div>
              <Button
                onClick={() => handleCapture()}
                disabled={refreshing}
                className="mx-auto gap-1.5"
              >
                {refreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Capturar agora
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {/* Dashboard completo */}
      {!initialLoading && data?.hasData && current && deltas && (
        <>
          <ProfileHeader profile={profile!} />

          {/* Veredito de crescimento */}
          <FollowerVerdict deltas={deltas} />

          {/* KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">Seguidores</p>
                  <div className="rounded-lg bg-muted p-2 text-pink-500">
                    <Users className="h-4 w-4" />
                  </div>
                </div>
                <p className="mt-3 text-2xl font-bold tabular-nums">
                  {formatNumber(current.followers)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {signed(deltas.periodNet)} ({signedPct(deltas.periodPct)}) em {deltas.periodDays} dias
                </p>
              </CardContent>
            </Card>

            <DeltaCard title="Variação 7 dias" delta={deltas.d7} />
            <DeltaCard title="Variação 30 dias" delta={deltas.d30} />

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">
                    Taxa de engajamento
                  </p>
                  <div className="rounded-lg bg-muted p-2 text-pink-500">
                    <Heart className="h-4 w-4" />
                  </div>
                </div>
                <p className="mt-3 text-2xl font-bold tabular-nums">
                  {engagement?.current != null ? `${engagement.current.toFixed(2)}%` : "—"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {engagement?.avgLikes != null
                    ? `${formatNumber(Math.round(engagement.avgLikes))} likes · ${formatNumber(
                        Math.round(engagement.avgComments || 0)
                      )} coment. / post`
                    : "sem posts amostrados"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Gráfico: seguidores ao longo do tempo */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Seguidores ao longo do tempo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.series} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <defs>
                      <linearGradient id="igFollowers" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ec4899" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                    <XAxis dataKey="label" stroke={chart.axis} fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis
                      stroke={chart.axis}
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      domain={["dataMin - 100", "dataMax + 100"]}
                      tickFormatter={(v) => formatNumber(v as number)}
                      width={56}
                    />
                    <RTooltip
                      contentStyle={chart.tooltipStyle}
                      formatter={(v) => formatNumber(v as number)}
                    />
                    <Area
                      type="monotone"
                      dataKey="followers"
                      name="Seguidores"
                      stroke="#ec4899"
                      fill="url(#igFollowers)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Grade 2 col: ganho/perda diário + engajamento */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ganho / perda diário de seguidores</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.series.filter((p) => p.dailyDelta != null)}
                      margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                      <XAxis dataKey="label" stroke={chart.axis} fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke={chart.axis} fontSize={12} tickLine={false} axisLine={false} width={48} />
                      <RTooltip
                        contentStyle={chart.tooltipStyle}
                        formatter={(v) => signed(v as number)}
                      />
                      <Bar dataKey="dailyDelta" name="Variação" radius={[3, 3, 0, 0]}>
                        {data.series
                          .filter((p) => p.dailyDelta != null)
                          .map((p, i) => (
                            <Cell
                              key={i}
                              fill={(p.dailyDelta ?? 0) >= 0 ? "#22c55e" : "#ef4444"}
                            />
                          ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Taxa de engajamento (%)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={data.series.filter((p) => p.engagementRate != null)}
                      margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                    >
                      <defs>
                        <linearGradient id="igEngage" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                      <XAxis dataKey="label" stroke={chart.axis} fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis
                        stroke={chart.axis}
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        width={44}
                        tickFormatter={(v) => `${(v as number).toFixed(1)}%`}
                      />
                      <RTooltip
                        contentStyle={chart.tooltipStyle}
                        formatter={(v) => `${(v as number).toFixed(2)}%`}
                      />
                      <Area
                        type="monotone"
                        dataKey="engagementRate"
                        name="Engajamento"
                        stroke="#8b5cf6"
                        fill="url(#igEngage)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top posts por engajamento */}
          {topPosts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Posts recentes com mais engajamento
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {topPosts.map((p) => (
                    <a
                      key={p.id}
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group overflow-hidden rounded-lg border transition-colors hover:border-pink-500/40"
                    >
                      <PostThumb post={p} />
                      <div className="space-y-1 p-2.5">
                        <div className="flex items-center gap-3 text-xs">
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Heart className="h-3 w-3" /> {formatNumber(p.likesCount)}
                          </span>
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <MessageCircle className="h-3 w-3" /> {formatNumber(p.commentsCount)}
                          </span>
                          <Badge variant="outline" className="ml-auto gap-1 px-1.5 py-0 text-[10px]">
                            <PostTypeIcon type={p.type} />
                          </Badge>
                        </div>
                        <p className="line-clamp-2 text-[11px] text-muted-foreground">
                          {p.caption || "Sem legenda"}
                        </p>
                      </div>
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ---------- header do perfil ----------

function ProfileHeader({
  profile,
}: {
  profile: NonNullable<SnapshotsResponse["profile"]>;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
        <ProfileAvatar url={profile.profilePicUrl} name={profile.username} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-lg font-bold">{profile.fullName || profile.username}</p>
            <a
              href={`https://www.instagram.com/${profile.username}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-pink-500 hover:underline"
            >
              @{profile.username}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {profile.biography && (
            <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
              {profile.biography}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <span>
              <strong className="tabular-nums">{formatNumber(profile.followersCount)}</strong>{" "}
              <span className="text-muted-foreground">seguidores</span>
            </span>
            <span>
              <strong className="tabular-nums">{formatNumber(profile.followingCount)}</strong>{" "}
              <span className="text-muted-foreground">seguindo</span>
            </span>
            <span>
              <strong className="tabular-nums">{formatNumber(profile.postsCount)}</strong>{" "}
              <span className="text-muted-foreground">posts</span>
            </span>
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          atualizado {timeAgo(profile.lastScrapedAt)}
        </div>
      </CardContent>
    </Card>
  );
}

function PostThumb({ post }: { post: IGPost }) {
  const [broken, setBroken] = useState(false);
  if (!post.displayUrl || broken) {
    return (
      <div className="flex aspect-square items-center justify-center bg-muted">
        <Instagram className="h-8 w-8 text-muted-foreground/40" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={post.displayUrl}
      alt=""
      className="aspect-square w-full object-cover"
      onError={() => setBroken(true)}
    />
  );
}
