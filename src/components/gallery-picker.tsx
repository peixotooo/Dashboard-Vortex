"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MediaItem {
  id: string;
  filename: string;
  image_url: string;
  image_hash: string | null;
  video_id?: string | null;
  created_at: string;
}

interface GalleryPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onSelect: (items: MediaItem[]) => void;
  skipMetaValidation?: boolean;
  singleSelect?: boolean;
}

export function GalleryPicker({
  open,
  onOpenChange,
  workspaceId,
  onSelect,
  skipMetaValidation = false,
  singleSelect = false,
}: GalleryPickerProps) {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchMedia = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ workspace_id: workspaceId });
      if (search) params.set("search", search);
      const res = await fetch(`/api/media?${params}`);
      if (res.ok) {
        const json = await res.json();
        setMedia(json.data || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [workspaceId, search]);

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      fetchMedia();
    }
  }, [open, fetchMedia]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      if (singleSelect) {
        // Toggle: if already selected, deselect; otherwise select only this
        return prev.has(id) ? new Set() : new Set([id]);
      }
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    const items = media.filter((m) => selected.has(m.id));
    onSelect(items);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Galeria de Midias</DialogTitle>
          <DialogDescription>
            {singleSelect
              ? "Selecione uma imagem para enviar"
              : "Selecione imagens ja enviadas para usar na conversa"}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex-1 overflow-y-auto min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : media.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              Nenhuma imagem encontrada
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 p-1">
              {media.map((item) => {
                const isValid = skipMetaValidation
                  ? !!item.image_url
                  : item.image_hash || item.video_id;
                const isSelected = selected.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!isValid}
                    onClick={() => isValid && toggleSelect(item.id)}
                    className={cn(
                      "relative aspect-square rounded-lg overflow-hidden border-2 transition-all group",
                      !isValid ? "opacity-50 cursor-not-allowed grayscale" : "cursor-pointer",
                      isSelected
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    {item.video_id ? (
                      <video
                        src={item.image_url}
                        className="w-full h-full object-cover"
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <img
                        src={item.image_url}
                        alt={item.filename}
                        className="w-full h-full object-cover"
                      />
                    )}
                    {isSelected && (
                      <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                        <div className="bg-primary rounded-full p-1">
                          <Check className="h-4 w-4 text-primary-foreground" />
                        </div>
                      </div>
                    )}
                    {!isValid && (
                      <div className="absolute inset-0 bg-destructive/20 flex flex-col items-center justify-center p-2 text-center text-xs font-semibold text-destructive">
                        Upload Invalido
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-[10px] text-white truncate">
                        {item.filename}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <span className="text-sm text-muted-foreground">
            {selected.size} selecionada{selected.size !== 1 ? "s" : ""}
          </span>
          <Button
            onClick={handleConfirm}
            disabled={selected.size === 0}
            size="sm"
          >
            {singleSelect ? "Usar selecionada" : "Usar selecionadas"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
