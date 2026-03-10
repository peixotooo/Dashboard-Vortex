"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Image as ImageIcon,
  Upload,
  Trash2,
  Search,
  Loader2,
  Copy,
  Check,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useWorkspace } from "@/lib/workspace-context";
import { useAccount } from "@/lib/account-context";
import { cn } from "@/lib/utils";

interface MediaItem {
  id: string;
  filename: string;
  image_url: string;
  image_hash: string | null;
  storage_path: string | null;
  file_size: number | null;
  mime_type: string | null;
  tags: string[];
  created_at: string;
}

export default function MediaGalleryPage() {
  const { workspace } = useWorkspace();
  const { accountId } = useAccount();
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const limit = 24;

  const fetchMedia = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        workspace_id: workspace.id,
        page: String(page),
        limit: String(limit),
      });
      if (search) params.set("search", search);
      const res = await fetch(`/api/media?${params}`);
      if (res.ok) {
        const json = await res.json();
        setMedia(json.data || []);
        setTotal(json.total || 0);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [workspace?.id, page, search]);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  // Reset page on search change
  useEffect(() => {
    setPage(1);
  }, [search]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || !workspace?.id || !accountId || accountId === "all") return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("filename", file, file.name);
        formData.append("account_id", accountId);
        await fetch("/api/media", {
          method: "POST",
          body: formData,
          headers: { "x-workspace-id": workspace.id },
        });
      }
      await fetchMedia();
    } catch {
      // ignore
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!workspace?.id) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/media?id=${id}`, {
        method: "DELETE",
        headers: { "x-workspace-id": workspace.id },
      });
      if (res.ok) {
        setMedia((prev) => prev.filter((m) => m.id !== id));
        setTotal((prev) => prev - 1);
        if (selectedItem?.id === id) setSelectedItem(null);
      }
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  };

  const copyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const totalPages = Math.ceil(total / limit);

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Galeria de Mídias</h1>
          <p className="text-muted-foreground text-sm">
            Imagens enviadas para campanhas — {total} arquivo{total !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              handleUpload(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !accountId || accountId === "all"}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            Upload
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : media.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ImageIcon className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="font-semibold text-lg">Nenhuma imagem</h3>
            <p className="text-muted-foreground text-sm mt-1 max-w-md">
              {search
                ? "Nenhuma imagem encontrada com esse nome."
                : "Faça upload de imagens aqui ou anexe no chat com os agentes."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {media.map((item) => (
              <div
                key={item.id}
                className="group relative aspect-square rounded-lg overflow-hidden border border-border bg-muted cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                onClick={() => setSelectedItem(item)}
              >
                <img
                  src={item.image_url}
                  alt={item.filename}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-[11px] text-white truncate font-medium">
                    {item.filename}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(item.id);
                  }}
                  disabled={deletingId === item.id}
                  className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-destructive cursor-pointer"
                >
                  {deletingId === item.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                </button>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} de {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                Próxima
              </Button>
            </div>
          )}
        </>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="truncate">{selectedItem?.filename}</DialogTitle>
            <DialogDescription>
              {selectedItem?.created_at
                ? new Date(selectedItem.created_at).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>

          {selectedItem && (
            <div className="space-y-4">
              <div className="rounded-lg overflow-hidden border border-border bg-muted">
                <img
                  src={selectedItem.image_url}
                  alt={selectedItem.filename}
                  className="w-full max-h-[400px] object-contain"
                />
              </div>

              <div className="space-y-2 text-sm">
                {selectedItem.image_hash && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Hash:</span>
                    <div className="flex items-center gap-1">
                      <code className="text-xs bg-muted px-2 py-1 rounded font-mono truncate max-w-[200px]">
                        {selectedItem.image_hash}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => copyHash(selectedItem.image_hash!)}
                      >
                        {copiedHash ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Tamanho:</span>
                  <span>{formatFileSize(selectedItem.file_size)}</span>
                </div>
                {selectedItem.mime_type && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Tipo:</span>
                    <span>{selectedItem.mime_type}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  className="ml-auto"
                  onClick={() => handleDelete(selectedItem.id)}
                  disabled={deletingId === selectedItem.id}
                >
                  {deletingId === selectedItem.id ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Trash2 className="h-3 w-3 mr-1" />
                  )}
                  Excluir
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
