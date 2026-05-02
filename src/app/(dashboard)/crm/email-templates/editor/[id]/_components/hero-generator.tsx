"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, Loader2, Wand2, Image as ImageIcon } from "lucide-react";
import { ProductPicker, type PickedProduct } from "./product-picker";

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  layoutId?: string;
  /** Current image URL — used to seed the product picker if matchable. */
  currentSrc?: string;
  /** Called with the generated hero URL on success. */
  onGenerated: (url: string, alt: string) => void;
}

const DEFAULT_LAYOUT_ID = "classic";

export function HeroGeneratorDialog({
  open,
  onClose,
  workspaceId,
  layoutId,
  onGenerated,
}: Props) {
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [picked, setPicked] = useState<PickedProduct | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPicked(null);
    setPrompt("");
    setLoading(false);
    setProgress("");
    setError(null);
  };

  const handleClose = () => {
    if (loading) return;
    reset();
    onClose();
  };

  const submit = async () => {
    if (!picked) {
      setError("Escolha o produto que será o foco da imagem.");
      return;
    }
    if (mode === "manual" && prompt.trim().length < 10) {
      setError("Escreva um prompt com pelo menos 10 caracteres.");
      return;
    }
    setError(null);
    setLoading(true);
    setProgress("Iniciando geração... pode levar 30-90s.");

    const productSnap = {
      vnda_id: picked.vnda_id,
      name: picked.name,
      price: picked.price,
      old_price: picked.old_price,
      image_url: picked.image_url,
      url: picked.url,
    };

    try {
      const body =
        mode === "auto"
          ? {
              mode: "auto" as const,
              layout_id: layoutId ?? DEFAULT_LAYOUT_ID,
              slot: 1,
              product: productSnap,
            }
          : {
              mode: "manual" as const,
              layout_id: layoutId ?? DEFAULT_LAYOUT_ID,
              slot: 1,
              product: productSnap,
              prompt: prompt.trim(),
            };

      setProgress(
        mode === "auto"
          ? "Gerando hero com prompt padrão do layout..."
          : "Gerando hero com seu prompt..."
      );

      const r = await fetch("/api/crm/email-templates/compose-hero", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok || !d.hero_url) {
        throw new Error(d.error ?? "kie.ai falhou. Tente novamente em alguns minutos.");
      }
      onGenerated(d.hero_url, picked.name);
      handleClose();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
      setProgress("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          Gerar header com IA
        </DialogTitle>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "auto" | "manual")}>
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="auto" className="gap-1.5 text-xs">
              <Wand2 className="w-3.5 h-3.5" /> Automático
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-1.5 text-xs">
              <ImageIcon className="w-3.5 h-3.5" /> Prompt manual
            </TabsTrigger>
          </TabsList>

          <TabsContent value="auto" className="space-y-3 mt-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              O prompt padrão do template será usado, com a foto do produto
              como referência principal e a paleta monocromática Bulking
              (branco/preto/cinzas).
            </p>
          </TabsContent>

          <TabsContent value="manual" className="space-y-3 mt-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Prompt</Label>
              <Textarea
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder='Ex: "Foto editorial em preto e branco, modelo masculino fitness vestindo a camiseta, fundo cimento, luz lateral suave, 3:4."'
                disabled={loading}
              />
              <div className="text-[11px] text-muted-foreground">
                A foto do produto vira referência principal automaticamente.
                Descreva apenas a cena/composição que você quer.
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Produto em destaque</Label>
          {picked ? (
            <div className="flex items-center gap-2 border rounded p-2 bg-muted/30">
              <img
                src={picked.image_url}
                alt={picked.name}
                className="w-9 h-12 object-cover shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs truncate">{picked.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  R$ {picked.price.toFixed(2)}
                </div>
              </div>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPicked(null)} disabled={loading}>
                Trocar
              </Button>
            </div>
          ) : (
            <ProductPicker
              workspaceId={workspaceId}
              autoLoadInitial
              onPick={(p) => setPicked(p)}
            />
          )}
        </div>

        {error && (
          <div className="text-xs text-destructive p-2 border border-destructive/30 rounded bg-destructive/5">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 border rounded bg-muted/30">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {progress}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={handleClose} disabled={loading}>
            Cancelar
          </Button>
          <Button size="sm" onClick={submit} disabled={loading || !picked} className="gap-1.5">
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            Gerar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
