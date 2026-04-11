"use client";

import { useState, useRef } from "react";
import { Loader2, ImagePlus, X, GripVertical } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/lib/workspace-context";

interface UploadedImage {
  file: File;
  preview: string;
  storage_key?: string;
  public_url?: string;
  uploaded: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collectionId: string;
  onCreated: () => void;
}

export function AddProductModal({ open, onOpenChange, collectionId, onCreated }: Props) {
  const { workspace } = useWorkspace();
  const [productName, setProductName] = useState("");
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const newImages: UploadedImage[] = Array.from(files).map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      uploaded: false,
    }));

    // If no name yet, derive from first file
    if (!productName && newImages.length > 0) {
      const name = newImages[0].file.name
        .replace(/\.[^.]+$/, "")
        .replace(/[-_]/g, " ")
        .toUpperCase()
        .replace(/\s*\d+$/, "") // remove trailing number (e.g. "pale-rider-1" → "PALE RIDER")
        .trim();
      setProductName(name);
    }

    setImages((prev) => [...prev, ...newImages]);
  }

  function removeImage(index: number) {
    setImages((prev) => {
      const next = [...prev];
      URL.revokeObjectURL(next[index].preview);
      next.splice(index, 1);
      return next;
    });
  }

  async function handleSubmit() {
    if (!workspace?.id || !productName.trim() || images.length === 0) return;
    setSaving(true);
    setError("");

    try {
      // Upload all images to B2
      const uploadedImages: { storage_key: string; public_url: string }[] = [];

      for (const img of images) {
        const urlRes = await fetch("/api/media/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: img.file.name, mime_type: img.file.type }),
        });
        if (!urlRes.ok) throw new Error("Erro ao gerar URL de upload");
        const { signedUrl, key, publicUrl } = await urlRes.json();

        await fetch(signedUrl, {
          method: "PUT",
          headers: { "Content-Type": img.file.type },
          body: img.file,
        });

        uploadedImages.push({ storage_key: key, public_url: publicUrl });
      }

      // Register product with all images
      const res = await fetch(`/api/pre-cadastro/collections/${collectionId}/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspace.id,
        },
        body: JSON.stringify({
          product_name: productName.trim(),
          images: uploadedImages,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao criar produto");
      }

      // Reset and close
      setProductName("");
      setImages([]);
      onOpenChange(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cadastrar Produto</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Nome do Produto</Label>
            <Input
              placeholder="Ex: CAMISETA OVERSIZED PALE RIDER PRETA"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
            />
          </div>

          {/* Image grid */}
          <div>
            <Label>Fotos do Produto</Label>
            <p className="text-xs text-muted-foreground mb-2">
              A primeira foto sera a principal. Arraste para reordenar.
            </p>

            <div className="grid grid-cols-3 gap-2 mb-2">
              {images.map((img, i) => (
                <div key={i} className="relative aspect-square rounded-md overflow-hidden border bg-muted group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.preview} alt="" className="w-full h-full object-cover" />
                  {i === 0 && (
                    <span className="absolute top-1 left-1 bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded">
                      Principal
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}

              {/* Add button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="aspect-square rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-1 hover:border-primary/50 transition-colors"
              >
                <ImagePlus className="h-5 w-5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Adicionar</span>
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={saving || !productName.trim() || images.length === 0}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {saving ? "Enviando fotos..." : `Adicionar (${images.length} foto${images.length > 1 ? "s" : ""})`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
