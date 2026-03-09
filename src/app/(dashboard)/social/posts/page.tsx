"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Heart,
  MessageCircle,
  ExternalLink,
  ArrowUpDown,
  Filter,
  X,
  Play,
  Layers,
  Image as ImageIcon,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatNumber } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

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

type SortMode = "engagement" | "likes" | "recent";
type FilterType = "all" | "Image" | "Video" | "Sidecar";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const m = Math.floor(d / 30);
  return `${m}m`;
}

const typeLabels: Record<string, string> = {
  Image: "Imagem",
  Video: "Video",
  Sidecar: "Carrossel",
};

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  Image: ImageIcon,
  Video: Play,
  Sidecar: Layers,
};

export default function PostsPage() {
  const { workspace } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<Post[]>([]);
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("engagement");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async (igUsername: string) => {
    if (!workspace?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/instagram/posts?username=${igUsername}&limit=50`,
        { headers: { "x-workspace-id": workspace.id } }
      );
      if (res.ok) {
        const data = await res.json();
        setPosts(data.posts || []);
        setUsername(igUsername);
      } else {
        const err = await res.json();
        setError(err.error || "Erro ao carregar posts");
      }
    } catch {
      setError("Erro ao conectar com a API");
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    if (!workspace?.id) return;
    async function findUsername() {
      try {
        const res = await fetch(`/api/workspaces?workspace_id=${workspace!.id}`);
        if (res.ok) {
          const data = await res.json();
          const igUser = data.instagramUsername;
          if (igUser) {
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
        setPosts(data.posts || []);
      }
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  };

  // Sort
  const sortedPosts = [...posts].sort((a, b) => {
    switch (sortMode) {
      case "engagement":
        return (b.likesCount + b.commentsCount) - (a.likesCount + a.commentsCount);
      case "likes":
        return b.likesCount - a.likesCount;
      case "recent":
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      default:
        return 0;
    }
  });

  // Filter
  const filteredPosts = filterType === "all"
    ? sortedPosts
    : sortedPosts.filter((p) => p.type === filterType);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-8 w-48 bg-muted animate-pulse rounded" />
            <div className="h-4 w-72 bg-muted animate-pulse rounded mt-2" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!username || error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Posts</h1>
          <p className="text-muted-foreground mt-1">
            Grid visual dos posts do Instagram
          </p>
        </div>
        <Card>
          <CardContent className="p-12 text-center">
            <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
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
          <h1 className="text-3xl font-bold tracking-tight">Posts</h1>
          <p className="text-muted-foreground mt-1">
            @{username} · {filteredPosts.length} posts
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

      {/* Sort & Filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
          {(["engagement", "likes", "recent"] as SortMode[]).map((mode) => (
            <Button
              key={mode}
              variant={sortMode === mode ? "default" : "ghost"}
              size="sm"
              onClick={() => setSortMode(mode)}
              className="text-xs"
            >
              {mode === "engagement" ? "Engagement" : mode === "likes" ? "Curtidas" : "Recentes"}
            </Button>
          ))}
        </div>
        <div className="h-4 w-px bg-border mx-1" />
        <div className="flex items-center gap-1">
          <Filter className="h-4 w-4 text-muted-foreground" />
          {(["all", "Image", "Video", "Sidecar"] as FilterType[]).map((type) => (
            <Button
              key={type}
              variant={filterType === type ? "default" : "ghost"}
              size="sm"
              onClick={() => setFilterType(type)}
              className="text-xs"
            >
              {type === "all" ? "Todos" : typeLabels[type]}
            </Button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {filteredPosts.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filteredPosts.map((post) => {
            const TypeIcon = typeIcons[post.type] || ImageIcon;
            return (
              <button
                key={post.id}
                onClick={() => setSelectedPost(post)}
                className="group relative aspect-square rounded-lg overflow-hidden bg-muted cursor-pointer border border-border hover:border-primary/50 transition-colors"
              >
                {post.displayUrl ? (
                  <img
                    src={post.displayUrl}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}

                {/* Type badge */}
                <div className="absolute top-2 right-2">
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-black/60 text-white border-0 backdrop-blur-sm"
                  >
                    <TypeIcon className="h-3 w-3 mr-1" />
                    {typeLabels[post.type]}
                  </Badge>
                </div>

                {/* Overlay on hover */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                  <span className="flex items-center gap-1 text-white text-sm font-medium">
                    <Heart className="h-4 w-4 fill-current" />
                    {formatNumber(post.likesCount)}
                  </span>
                  <span className="flex items-center gap-1 text-white text-sm font-medium">
                    <MessageCircle className="h-4 w-4 fill-current" />
                    {formatNumber(post.commentsCount)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Nenhum post encontrado</p>
          </CardContent>
        </Card>
      )}

      {/* Post Detail Dialog */}
      <Dialog
        open={!!selectedPost}
        onOpenChange={(open) => !open && setSelectedPost(null)}
      >
        {selectedPost && (
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {typeLabels[selectedPost.type]}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {timeAgo(selectedPost.timestamp)} atras
                  </span>
                </div>
              </DialogTitle>
            </DialogHeader>

            {/* Image */}
            {selectedPost.displayUrl && (
              <div className="rounded-lg overflow-hidden bg-muted">
                <img
                  src={selectedPost.displayUrl}
                  alt=""
                  className="w-full max-h-[400px] object-contain"
                />
              </div>
            )}

            {/* Metrics */}
            <div className="flex items-center gap-6 py-3">
              <span className="flex items-center gap-2 text-sm">
                <Heart className="h-4 w-4 text-red-500" />
                <span className="font-semibold">{formatNumber(selectedPost.likesCount)}</span>
                curtidas
              </span>
              <span className="flex items-center gap-2 text-sm">
                <MessageCircle className="h-4 w-4 text-blue-500" />
                <span className="font-semibold">{formatNumber(selectedPost.commentsCount)}</span>
                comentarios
              </span>
            </div>

            {/* Caption */}
            {selectedPost.caption && (
              <div className="space-y-2">
                <p className="text-sm whitespace-pre-wrap">
                  {selectedPost.caption}
                </p>
              </div>
            )}

            {/* Hashtags */}
            {selectedPost.hashtags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedPost.hashtags.map((tag, i) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {/* Link */}
            <a
              href={selectedPost.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              Ver no Instagram
            </a>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
