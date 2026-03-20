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
  FileVideo,
  CheckCircle2,
  AlertCircle,
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

interface UploadItem {
  id: string;
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
}

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "application/pdf",
];

const MAX_CONCURRENT = 4;

export default function MediaGalleryPage() {
  const { workspace } = useWorkspace();
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeUploads = useRef(0);

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

  useEffect(() => {
    setPage(1);
  }, [search]);

  // --- Upload logic ---

  const uploadSingleFile = async (item: UploadItem) => {
    if (!workspace?.id) return;

    setUploads((prev) =>
      prev.map((u) => (u.id === item.id ? { ...u, status: "uploading", progress: 0 } : u))
    );

    try {
      // 1. Get presigned URL
      const urlRes = await fetch("/api/media/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: item.file.name, mime_type: item.file.type }),
      });

      if (!urlRes.ok) {
        const err = await urlRes.json().catch(() => ({ error: "Erro ao gerar URL" }));
        throw new Error(err.error || "Erro ao gerar URL de upload");
      }

      const { signedUrl, key } = await urlRes.json();

      // 2. Upload directly to B2 via presigned URL with progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signedUrl);
        xhr.setRequestHeader("Content-Type", item.file.type);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploads((prev) =>
              prev.map((u) => (u.id === item.id ? { ...u, progress: pct } : u))
            );
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload falhou (${xhr.status})`));
        };

        xhr.onerror = () => reject(new Error("Erro de rede no upload"));
        xhr.send(item.file);
      });

      // 3. Register in DB (B2-only, no Meta)
      const regRes = await fetch("/api/media", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspace.id,
        },
        body: JSON.stringify({
          storage_key: key,
          filename: item.file.name,
          mime_type: item.file.type,
          file_size: item.file.size,
        }),
      });

      if (!regRes.ok) {
        const err = await regRes.json().catch(() => ({ error: "Erro ao registrar" }));
        throw new Error(err.error || "Erro ao registrar arquivo");
      }

      setUploads((prev) =>
        prev.map((u) => (u.id === item.id ? { ...u, status: "done", progress: 100 } : u))
      );
    } catch (err: any) {
      setUploads((prev) =>
        prev.map((u) =>
          u.id === item.id ? { ...u, status: "error", error: err.message } : u
        )
      );
    }
  };

  const processQueue = useCallback(async () => {
    setUploads((current) => {
      const pending = current.filter((u) => u.status === "pending");
      const slotsAvailable = MAX_CONCURRENT - activeUploads.current;

      if (slotsAvailable <= 0 || pending.length === 0) return current;

      const toStart = pending.slice(0, slotsAvailable);
      for (const item of toStart) {
        activeUploads.current++;
        uploadSingleFile(item).finally(() => {
          activeUploads.current--;
          processQueue();
        });
      }

      return current;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  // Trigger queue processing when uploads change
  useEffect(() => {
    if (uploads.some((u) => u.status === "pending")) {
      processQueue();
    }
    // Refresh gallery when all uploads are done
    const allDone = uploads.length > 0 && uploads.every((u) => u.status === "done" || u.status === "error");
    if (allDone && uploads.some((u) => u.status === "done")) {
      fetchMedia();
    }
  }, [uploads, processQueue, fetchMedia]);

  const addFiles = (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const valid = fileArray.filter((f) => ACCEPTED_TYPES.includes(f.type));
    if (valid.length === 0) return;

    const newItems: UploadItem[] = valid.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      status: "pending" as const,
      progress: 0,
    }));

    setUploads((prev) => [...prev, ...newItems]);
  };

  const clearFinished = () => {
    setUploads((prev) => prev.filter((u) => u.status !== "done" && u.status !== "error"));
  };

  // --- Drag & Drop ---

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  // --- Delete ---

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
    if (!bytes) return "\u2014";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isVideo = (mimeType: string | null) => mimeType?.startsWith("video/");

  const uploadingCount = uploads.filter((u) => u.status === "uploading" || u.status === "pending").length;
  const doneCount = uploads.filter((u) => u.status === "done").length;
  const errorCount = uploads.filter((u) => u.status === "error").length;

  return (
    <div
      className="space-y-6 p-6 min-h-[calc(100vh-4rem)]"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {dragOver && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="border-2 border-dashed border-primary rounded-2xl p-16 text-center">
            <Upload className="h-12 w-12 text-primary mx-auto mb-4" />
            <p className="text-lg font-semibold">Solte os arquivos aqui</p>
            <p className="text-sm text-muted-foreground mt-1">
              Imagens, v\u00eddeos e PDFs
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Galeria de M\u00eddias</h1>
          <p className="text-muted-foreground text-sm">
            Arquivos enviados para campanhas \u2014 {total} arquivo{total !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            Upload
          </Button>
        </div>
      </div>

      {/* Upload progress panel */}
      {uploads.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {uploadingCount > 0
                  ? `Enviando ${uploadingCount} arquivo${uploadingCount !== 1 ? "s" : ""}...`
                  : `Upload conclu\u00eddo`}
                {doneCount > 0 && (
                  <span className="text-muted-foreground ml-2">{doneCount} enviado{doneCount !== 1 ? "s" : ""}</span>
                )}
                {errorCount > 0 && (
                  <span className="text-destructive ml-2">{errorCount} erro{errorCount !== 1 ? "s" : ""}</span>
                )}
              </p>
              {uploadingCount === 0 && (
                <Button variant="ghost" size="sm" onClick={clearFinished}>
                  <X className="h-3 w-3 mr-1" />
                  Limpar
                </Button>
              )}
            </div>

            <div className="max-h-48 overflow-y-auto space-y-2">
              {uploads.map((item) => (
                <div key={item.id} className="flex items-center gap-3 text-sm">
                  {item.status === "done" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  ) : item.status === "error" ? (
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                  )}
                  <span className="truncate flex-1 min-w-0">{item.file.name}</span>
                  <span className="text-muted-foreground text-xs shrink-0 w-16 text-right">
                    {item.status === "error"
                      ? "Erro"
                      : item.status === "done"
                        ? "OK"
                        : item.status === "uploading"
                          ? `${item.progress}%`
                          : "Fila"}
                  </span>
                  {item.status === "uploading" && (
                    <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden shrink-0">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
            <h3 className="font-semibold text-lg">Nenhuma m\u00eddia</h3>
            <p className="text-muted-foreground text-sm mt-1 max-w-md">
              {search
                ? "Nenhuma m\u00eddia encontrada com esse nome."
                : "Arraste arquivos aqui ou clique em Upload para enviar imagens e v\u00eddeos."}
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
                {isVideo(item.mime_type) ? (
                  <div className="w-full h-full flex items-center justify-center bg-muted">
                    <FileVideo className="h-10 w-10 text-muted-foreground" />
                  </div>
                ) : (
                  <img
                    src={item.image_url}
                    alt={item.filename}
                    className="w-full h-full object-cover"
                  />
                )}
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
                Pr\u00f3xima
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
                {isVideo(selectedItem.mime_type) ? (
                  <video
                    src={selectedItem.image_url}
                    controls
                    className="w-full max-h-[400px]"
                  />
                ) : (
                  <img
                    src={selectedItem.image_url}
                    alt={selectedItem.filename}
                    className="w-full max-h-[400px] object-contain"
                  />
                )}
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
