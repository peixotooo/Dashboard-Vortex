"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Users,
  Image,
  Heart,
  MessageCircle,
  RefreshCw,
  ExternalLink,
  Loader2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

const tooltipStyle = {
  backgroundColor: "#12121a",
  border: "1px solid #2a2a3e",
  borderRadius: "8px",
  color: "#f0f0f5",
  fontSize: "12px",
};

interface Profile {
  username: string;
  fullName: string;
  biography: string;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  profilePicUrl: string;
  externalUrl?: string;
  businessCategory?: string;
}

interface Post {
  id: string;
  shortCode: string;
  url: string;
  type: "Image" | "Video" | "Sidecar";
  timestamp: string;
  caption: string;
  hashtags: string[];
  likesCount: number;
  commentsCount: number;
  displayUrl: string;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export default function SocialPage() {
  const { workspace } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [lastScraped, setLastScraped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  const loadData = useCallback(async (igUsername: string) => {
    if (!workspace?.id) return;
    setLoading(true);
    setError(null);

    try {
      const headers = { "x-workspace-id": workspace.id };
      const [profileRes, postsRes] = await Promise.all([
        fetch(`/api/instagram/profile?username=${igUsername}`, { headers }),
        fetch(`/api/instagram/posts?username=${igUsername}&limit=30`, { headers }),
      ]);

      if (profileRes.ok) {
        const pData = await profileRes.json();
        setProfile(pData.profile);
        setLastScraped(pData.lastScrapedAt);
        setUsername(igUsername);
      } else {
        const err = await profileRes.json();
        setError(err.error || "Erro ao carregar perfil");
        setLoading(false);
        return;
      }

      if (postsRes.ok) {
        const postsData = await postsRes.json();
        setPosts(postsData.posts || []);
      }
    } catch {
      setError("Erro ao conectar com a API");
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  // On mount, try to find the configured username
  useEffect(() => {
    if (!workspace?.id) return;

    async function findUsername() {
      // Check if there's a stored profile with this workspace
      try {
        const res = await fetch(`/api/workspaces?workspace_id=${workspace!.id}`);
        if (res.ok) {
          const data = await res.json();
          const igUser = data.instagramUsername;
          if (igUser) {
            setUsername(igUser);
            loadData(igUser);
            return;
          }
        }
      } catch {
        // ignore
      }
      setLoading(false);
    }

    findUsername();
  }, [workspace?.id, loadData]);

  const handleRefresh = async () => {
    if (!workspace?.id || !username) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/instagram/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspace.id,
        },
        body: JSON.stringify({ username }),
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data.profile);
        setPosts(data.posts || []);
        setLastScraped(data.lastScrapedAt);
      }
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  };

  // Calculate KPIs
  const engagementRate = profile && posts.length > 0
    ? posts.reduce((sum, p) => sum + ((p.likesCount + p.commentsCount) / profile.followersCount) * 100, 0) / posts.length
    : 0;
  const avgLikes = posts.length > 0
    ? Math.round(posts.reduce((sum, p) => sum + p.likesCount, 0) / posts.length)
    : 0;

  // Chart data — last 12 posts (oldest first)
  const chartData = posts
    .slice(0, 12)
    .reverse()
    .map((p, i) => ({
      name: `Post ${i + 1}`,
      curtidas: p.likesCount,
      comentarios: p.commentsCount,
    }));

  // Top posts by engagement
  const topPosts = [...posts]
    .sort((a, b) => (b.likesCount + b.commentsCount) - (a.likesCount + a.commentsCount))
    .slice(0, 5);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-8 w-48 bg-muted animate-pulse rounded" />
            <div className="h-4 w-72 bg-muted animate-pulse rounded mt-2" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <KpiCard key={i} title="" value="" icon={Users} loading />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card><CardContent className="p-6"><div className="h-40 bg-muted animate-pulse rounded" /></CardContent></Card>
          <Card className="lg:col-span-2"><CardContent className="p-6"><div className="h-40 bg-muted animate-pulse rounded" /></CardContent></Card>
        </div>
      </div>
    );
  }

  if (!username || error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Instagram</h1>
          <p className="text-muted-foreground mt-1">
            Acompanhe o desempenho do seu perfil
          </p>
        </div>
        <Card>
          <CardContent className="p-12 text-center">
            <Image className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">
              {error || "Configure seu Instagram"}
            </h3>
            <p className="text-muted-foreground mt-2 max-w-md mx-auto">
              {error
                ? "Verifique sua configuracao do Apify e tente novamente."
                : "Va em Settings > Social Media para configurar seu token Apify e username do Instagram."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Instagram</h1>
          <p className="text-muted-foreground mt-1">
            @{profile?.username || username}
            {lastScraped && (
              <span className="ml-2 text-xs">
                · Atualizado ha {timeAgo(lastScraped)}
              </span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Atualizar
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Seguidores"
          value={formatCompact(profile?.followersCount || 0)}
          icon={Users}
          iconColor="text-blue-500"
        />
        <KpiCard
          title="Posts"
          value={formatNumber(profile?.postsCount || 0)}
          icon={Image}
          iconColor="text-purple-500"
        />
        <KpiCard
          title="Engajamento"
          value={`${engagementRate.toFixed(2)}%`}
          icon={Heart}
          iconColor="text-pink-500"
        />
        <KpiCard
          title="Media de Curtidas"
          value={formatCompact(avgLikes)}
          icon={Heart}
          iconColor="text-red-500"
        />
      </div>

      {/* Profile + Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Profile card */}
        {profile && (
          <Card>
            <CardContent className="p-6">
              <div className="flex flex-col items-center text-center">
                {profile.profilePicUrl ? (
                  <img
                    src={profile.profilePicUrl}
                    alt={profile.username}
                    className="h-20 w-20 rounded-full object-cover mb-3"
                  />
                ) : (
                  <div className="h-20 w-20 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-2xl font-bold mb-3">
                    {profile.username[0]?.toUpperCase()}
                  </div>
                )}
                <h3 className="font-bold text-lg">{profile.fullName || profile.username}</h3>
                <p className="text-sm text-muted-foreground">@{profile.username}</p>
                {profile.businessCategory && (
                  <Badge variant="secondary" className="mt-1 text-xs">
                    {profile.businessCategory}
                  </Badge>
                )}
                <p className="text-sm text-muted-foreground mt-3 line-clamp-3">
                  {profile.biography}
                </p>
                {profile.externalUrl && (
                  <a
                    href={profile.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary mt-2 flex items-center gap-1 hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {profile.externalUrl.replace(/https?:\/\//, "").slice(0, 30)}
                  </a>
                )}
                <div className="grid grid-cols-3 gap-4 mt-4 w-full">
                  <div>
                    <div className="font-bold">{formatCompact(profile.postsCount)}</div>
                    <div className="text-xs text-muted-foreground">Posts</div>
                  </div>
                  <div>
                    <div className="font-bold">{formatCompact(profile.followersCount)}</div>
                    <div className="text-xs text-muted-foreground">Seguidores</div>
                  </div>
                  <div>
                    <div className="font-bold">{formatCompact(profile.followingCount)}</div>
                    <div className="text-xs text-muted-foreground">Seguindo</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Engagement chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Engagement - Ultimos 12 Posts
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#888" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#888" />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="curtidas" fill="#E1306C" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="comentarios" fill="#833AB4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
                Sem dados de posts
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Posts */}
      {topPosts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Top Posts por Engagement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topPosts.map((post) => (
                <div key={post.id} className="flex items-center gap-4 py-2">
                  {post.displayUrl ? (
                    <img
                      src={post.displayUrl}
                      alt=""
                      className="h-14 w-14 rounded-lg object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-14 w-14 rounded-lg bg-muted shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">
                      {post.caption?.slice(0, 80) || "Sem legenda"}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Heart className="h-3 w-3" />
                        {formatNumber(post.likesCount)}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageCircle className="h-3 w-3" />
                        {formatNumber(post.commentsCount)}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {post.type === "Sidecar" ? "Carrossel" : post.type}
                      </Badge>
                    </div>
                  </div>
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
