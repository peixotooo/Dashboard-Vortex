"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sparkles,
  Loader2,
  Wand2,
  ArrowRight,
  Tag,
  Search,
  X,
} from "lucide-react";

interface LayoutMeta {
  id: string;
  pattern_name: string;
  reference_image: string;
  mode: "light" | "dark";
}

interface PickedProduct {
  vnda_id: string;
  name: string;
  price: number;
  image_url: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
}

/** Quick-click context chips to seed the textarea. */
const CONTEXT_CHIPS: Array<{ label: string; text: string }> = [
  {
    label: "Promoção noturna",
    text: "Promoção da madrugada — desconto exclusivo só esta noite, expira em 6 horas.",
  },
  {
    label: "Frete grátis",
    text: "Frete grátis em todo o site neste fim de semana, sem mínimo.",
  },
  {
    label: "Lançamento",
    text: "Lançamento de uma nova peça da coleção. Limited drop, primeira semana de exposição.",
  },
  {
    label: "Última chance",
    text: "Última chance — estoque acabando da peça mais vendida da semana, com 10% off.",
  },
  {
    label: "Volta às aulas",
    text: "Volta às aulas — combo conforto pra quem treina antes ou depois das aulas.",
  },
  {
    label: "Black Friday",
    text: "Black Friday Bulking — 30% off em uma seleção curada da coleção, prazo até segunda.",
  },
  {
    label: "Reativação",
    text: "Reativação de cliente que sumiu por mais de 60 dias. Tom: 'sentimos sua falta', sem desconto.",
  },
  {
    label: "Aniversário",
    text: "Email de aniversário do cliente com cupom de presente válido por 7 dias.",
  },
];

const TONES: Array<{ id: "urgent" | "premium" | "playful" | "minimal"; label: string }> = [
  { id: "urgent", label: "Urgente" },
  { id: "premium", label: "Premium" },
  { id: "playful", label: "Brincalhão" },
  { id: "minimal", label: "Minimal" },
];

export function AIComposeDialog({ open, onClose, workspaceId }: Props) {
  type Tone = "urgent" | "premium" | "playful" | "minimal";
  const [context, setContext] = useState("");
  const [tone, setTone] = useState<Tone | null>(null);
  const [layouts, setLayouts] = useState<LayoutMeta[]>([]);
  const [layoutId, setLayoutId] = useState<string | null>(null);
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<PickedProduct[]>([]);
  const [productOpen, setProductOpen] = useState(false);
  const [couponEnabled, setCouponEnabled] = useState(false);
  const [couponPct, setCouponPct] = useState(10);
  const [couponHours, setCouponHours] = useState(48);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load layouts when dialog opens
  useEffect(() => {
    if (!open || !workspaceId) return;
    fetch("/api/crm/email-templates/layouts", {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d) => {
        const list = (d.layouts ?? []) as LayoutMeta[];
        setLayouts(list);
        if (list.length > 0 && !layoutId) setLayoutId(list[0].id);
      });
  }, [open, workspaceId, layoutId]);

  // Product search
  useEffect(() => {
    if (!open || !workspaceId) return;
    const term = productSearch.trim();
    if (term.length < 2 && !productOpen) return;
    const t = window.setTimeout(async () => {
      const r = await fetch(
        `/api/crm/email-templates/vnda-search${term.length >= 2 ? `?q=${encodeURIComponent(term)}` : ""}`,
        { headers: { "x-workspace-id": workspaceId } }
      );
      const d = await r.json();
      setProductResults(d.products ?? []);
    }, 250);
    return () => window.clearTimeout(t);
  }, [productSearch, workspaceId, open, productOpen]);

  const reset = () => {
    setContext("");
    setTone(null);
    setProduct(null);
    setProductSearch("");
    setProductResults([]);
    setCouponEnabled(false);
    setCouponPct(10);
    setCouponHours(48);
    setError(null);
    setLoading(false);
  };

  const close = () => {
    if (loading) return;
    onClose();
    setTimeout(reset, 200);
  };

  const submit = async () => {
    if (context.trim().length < 5) {
      setError("Conte um pouco do contexto pra IA escrever a copy.");
      return;
    }
    if (!layoutId) {
      setError("Escolha um template.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/api/crm/email-templates/ai-compose", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          context: context.trim(),
          layout_id: layoutId,
          product_id: product?.vnda_id,
          tone: tone ?? undefined,
          coupon: couponEnabled
            ? {
                discount_percent: couponPct,
                expires_in_hours: couponHours,
              }
            : undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.draft?.id) {
        throw new Error(d.error ?? "Falha ao montar o email.");
      }
      window.location.href = `/crm/email-templates/editor/${d.draft.id}`;
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  // Group layouts by reference_image so the picker shows one card per family.
  const layoutFamilies = (() => {
    const seen = new Set<string>();
    const out: LayoutMeta[] = [];
    for (const l of layouts) {
      const key = `${l.reference_image}-${l.mode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(l);
    }
    return out;
  })();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          Criar email com IA
        </DialogTitle>
        <p className="text-xs text-muted-foreground -mt-2">
          Conte o contexto em linguagem natural, escolha um template e em poucos
          cliques você recebe o email pronto pra editar.
        </p>

        {/* 1. Contexto */}
        <div className="space-y-2">
          <Label className="text-xs flex items-center gap-1.5">
            <span className="inline-block w-5 h-5 rounded-full bg-foreground text-background text-[10px] font-bold flex items-center justify-center">
              1
            </span>
            Contexto do email
          </Label>
          <Textarea
            rows={3}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder='Ex: "Promoção da madrugada — 20% off só esta noite, expira em 6h"'
            disabled={loading}
          />
          <div className="flex items-center gap-1.5 flex-wrap">
            {CONTEXT_CHIPS.map((c) => (
              <button
                key={c.label}
                type="button"
                disabled={loading}
                onClick={() => setContext(c.text)}
                className="inline-flex items-center gap-1 px-2 h-6 rounded-full border border-border/60 text-[11px] hover:border-foreground/40 hover:bg-muted/40 transition-colors disabled:opacity-50"
              >
                <Tag className="w-2.5 h-2.5 opacity-60" />
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* 2. Template */}
        <div className="space-y-2">
          <Label className="text-xs flex items-center gap-1.5">
            <span className="inline-block w-5 h-5 rounded-full bg-foreground text-background text-[10px] font-bold flex items-center justify-center">
              2
            </span>
            Template
            {layoutId && (
              <span className="font-mono text-[10px] text-muted-foreground ml-1">
                · {layoutId}
              </span>
            )}
          </Label>
          {layouts.length === 0 ? (
            <div className="text-xs text-muted-foreground">Carregando templates...</div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 max-h-44 overflow-y-auto p-1">
              {layoutFamilies.map((l) => {
                const family = l.id.replace(/-(light|dark)$/, "");
                const active = layoutId === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    disabled={loading}
                    onClick={() => setLayoutId(l.id)}
                    className={`flex flex-col items-start text-left p-2 rounded border transition-colors disabled:opacity-50 ${
                      active
                        ? "border-foreground bg-foreground/5"
                        : "border-border bg-card hover:border-foreground/40"
                    }`}
                  >
                    <span className="text-[11px] font-medium leading-tight truncate w-full">
                      {family}
                    </span>
                    <span className="text-[10px] text-muted-foreground uppercase">
                      {l.mode}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 3. Produto */}
        <div className="space-y-2">
          <Label className="text-xs flex items-center gap-1.5">
            <span className="inline-block w-5 h-5 rounded-full bg-foreground text-background text-[10px] font-bold flex items-center justify-center">
              3
            </span>
            Produto em destaque
            <span className="text-[10px] text-muted-foreground font-normal ml-1">
              (opcional · IA escolhe o best-seller atual se vazio)
            </span>
          </Label>
          {product ? (
            <div className="flex items-center gap-2 border rounded p-2 bg-muted/30">
              <img
                src={product.image_url}
                alt={product.name}
                className="w-9 h-12 object-cover shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs truncate">{product.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  R$ {product.price.toFixed(2)}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => setProduct(null)}
                disabled={loading}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            <div className="relative">
              <div className="flex items-center gap-2 border rounded-md px-2 h-8 bg-background focus-within:border-foreground/40">
                <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <input
                  placeholder="Buscar produto VNDA (deixe vazio pra IA escolher o best-seller)"
                  value={productSearch}
                  onChange={(e) => {
                    setProductSearch(e.target.value);
                    setProductOpen(true);
                  }}
                  onFocus={() => setProductOpen(true)}
                  className="bg-transparent outline-none text-xs flex-1 min-w-0"
                  disabled={loading}
                />
              </div>
              {productOpen && productResults.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-background border rounded-md shadow-lg max-h-56 overflow-y-auto">
                  {productResults.slice(0, 12).map((p) => (
                    <button
                      key={p.vnda_id}
                      type="button"
                      onClick={() => {
                        setProduct(p);
                        setProductSearch("");
                        setProductOpen(false);
                      }}
                      className="w-full flex items-center gap-2 p-2 hover:bg-muted text-left"
                    >
                      <img
                        src={p.image_url}
                        alt={p.name}
                        className="w-7 h-9 object-cover shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs truncate">{p.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          R$ {p.price.toFixed(2)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 4. Tom (opcional) */}
        <div className="space-y-2">
          <Label className="text-xs flex items-center gap-1.5">
            <span className="inline-block w-5 h-5 rounded-full border border-foreground/30 text-foreground/70 text-[10px] font-bold flex items-center justify-center">
              4
            </span>
            Tom <span className="text-[10px] text-muted-foreground font-normal ml-1">(opcional)</span>
          </Label>
          <div className="flex flex-wrap gap-1">
            {TONES.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant={tone === t.id ? "default" : "outline"}
                className="h-7 text-xs"
                disabled={loading}
                onClick={() => setTone(tone === t.id ? null : t.id)}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </div>

        {/* 5. Cupom (opcional) */}
        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Cupom + countdown (opcional)</Label>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={loading}
              onClick={() => setCouponEnabled((v) => !v)}
            >
              {couponEnabled ? "Remover" : "Adicionar"}
            </Button>
          </div>
          {couponEnabled && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">% off</Label>
                <Input
                  type="number"
                  value={couponPct}
                  onChange={(e) => setCouponPct(parseFloat(e.target.value) || 0)}
                  disabled={loading}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Termina em (h)</Label>
                <Input
                  type="number"
                  value={couponHours}
                  onChange={(e) => setCouponHours(parseFloat(e.target.value) || 0)}
                  disabled={loading}
                />
              </div>
            </div>
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
            IA escrevendo a copy e montando o email... (~10-20s)
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={close} disabled={loading}>
            Cancelar
          </Button>
          <Button size="sm" onClick={submit} disabled={loading} className="gap-1.5">
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Wand2 className="w-3.5 h-3.5" />
            )}
            Montar email
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
