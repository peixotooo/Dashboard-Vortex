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
      <DialogContent className="max-w-5xl max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b bg-gradient-to-br from-foreground/[0.03] via-card to-foreground/[0.06]">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <div className="w-8 h-8 rounded-lg bg-foreground text-background flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            Criar email com IA
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1.5 ml-10">
            Conte o contexto, escolha um template e a IA monta o email pronto pra editar.
          </p>
        </div>

        {/* Body — context (full-width) + 2-column grid below */}
        <div className="flex-1 overflow-y-auto">
          {/* Step 1 — Contexto */}
          <div className="px-6 pt-5 pb-4 border-b">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-foreground text-background text-[10px] font-bold">
                1
              </span>
              <Label className="text-xs uppercase tracking-widest">Contexto</Label>
            </div>
            <Textarea
              rows={3}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder='Ex: "Promoção da madrugada — 20% off só esta noite, expira em 6h"'
              disabled={loading}
              className="resize-none"
            />
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              {CONTEXT_CHIPS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  disabled={loading}
                  onClick={() => setContext(c.text)}
                  className="inline-flex items-center gap-1 px-2.5 h-6 rounded-full border border-border/60 text-[11px] hover:border-foreground/40 hover:bg-muted/40 transition-colors disabled:opacity-50"
                >
                  <Tag className="w-2.5 h-2.5 opacity-60" />
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* 2-column grid: Template (left, prominent) + Settings (right) */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] divide-y lg:divide-y-0 lg:divide-x">
            {/* Step 2 — Template (left, prominent) */}
            <div className="px-6 py-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-foreground text-background text-[10px] font-bold">
                  2
                </span>
                <Label className="text-xs uppercase tracking-widest">Template</Label>
                {layoutId && (
                  <span className="font-mono text-[10px] text-muted-foreground ml-auto truncate">
                    {layoutId}
                  </span>
                )}
              </div>
              {layouts.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando templates...
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {layoutFamilies.map((l) => (
                    <TemplateThumbCard
                      key={l.id}
                      layout={l}
                      workspaceId={workspaceId}
                      active={layoutId === l.id}
                      loading={loading}
                      onSelect={() => setLayoutId(l.id)}
                      productId={product?.vnda_id}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Settings column (right): Produto · Tom · Cupom */}
            <div className="px-6 py-5 space-y-5 bg-muted/10">
              {/* Step 3 — Produto */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-foreground text-background text-[10px] font-bold">
                    3
                  </span>
                  <Label className="text-xs uppercase tracking-widest">Produto</Label>
                </div>
                <p className="text-[10px] text-muted-foreground -mt-1">
                  Opcional · vazio = IA pega o best-seller atual.
                </p>
                {product ? (
                  <div className="flex items-center gap-2 border rounded-md p-2 bg-background">
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="w-10 h-12 object-cover shrink-0 rounded"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs truncate font-medium">{product.name}</div>
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
                    <div className="flex items-center gap-2 border rounded-md px-2 h-9 bg-background focus-within:border-foreground/40">
                      <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <input
                        placeholder="Buscar produto..."
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

              {/* Step 4 — Tom */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-foreground/30 text-foreground/70 text-[10px] font-bold">
                    4
                  </span>
                  <Label className="text-xs uppercase tracking-widest">Tom</Label>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    opcional
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {TONES.map((t) => (
                    <Button
                      key={t.id}
                      size="sm"
                      variant={tone === t.id ? "default" : "outline"}
                      className="h-8 text-xs"
                      disabled={loading}
                      onClick={() => setTone(tone === t.id ? null : t.id)}
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Step 5 — Cupom */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-foreground/30 text-foreground/70 text-[10px] font-bold">
                      5
                    </span>
                    <Label className="text-xs uppercase tracking-widest">
                      Cupom + countdown
                    </Label>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={couponEnabled}
                    disabled={loading}
                    onClick={() => setCouponEnabled((v) => !v)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors disabled:opacity-50 ${
                      couponEnabled
                        ? "bg-foreground border-foreground"
                        : "bg-card border-border"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 mt-[2px] transform rounded-full bg-background transition ${
                        couponEnabled ? "translate-x-5" : "translate-x-[2px]"
                      }`}
                    />
                  </button>
                </div>
                {couponEnabled && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        % off
                      </Label>
                      <Input
                        type="number"
                        value={couponPct}
                        onChange={(e) => setCouponPct(parseFloat(e.target.value) || 0)}
                        disabled={loading}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        Termina em (h)
                      </Label>
                      <Input
                        type="number"
                        value={couponHours}
                        onChange={(e) => setCouponHours(parseFloat(e.target.value) || 0)}
                        disabled={loading}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Sticky action bar */}
        <div className="border-t bg-card px-6 py-3 flex items-center gap-3">
          {error && (
            <div className="text-xs text-destructive flex-1 min-w-0 truncate">
              {error}
            </div>
          )}
          {loading && !error && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              IA escrevendo a copy e montando o email... (~10-20s)
          </div>
          )}
          {!error && !loading && (
            <div className="text-[11px] text-muted-foreground flex-1">
              {context.trim().length >= 5 && layoutId ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Pronto pra montar
                </span>
              ) : (
                <span>
                  {context.trim().length < 5 ? "Conte o contexto · " : ""}
                  {!layoutId ? "Escolha um template" : ""}
                </span>
              )}
            </div>
          )}
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

function TemplateThumbCard({
  layout,
  workspaceId,
  active,
  loading,
  onSelect,
  productId,
}: {
  layout: LayoutMeta;
  workspaceId: string;
  active: boolean;
  loading: boolean;
  onSelect: () => void;
  productId?: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const family = layout.id.replace(/-(light|dark)$/, "");

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ slot: "1", hero: "off" });
    if (productId) params.set("product_id", productId);
    fetch(`/api/crm/email-templates/layouts/${layout.id}/preview?${params}`, {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setHtml(d.html ?? "");
      })
      .catch(() => {
        if (!cancelled) setHtml("");
      });
    return () => {
      cancelled = true;
    };
  }, [layout.id, workspaceId, productId]);

  return (
    <button
      type="button"
      disabled={loading}
      onClick={onSelect}
      className={`group relative overflow-hidden rounded-lg border bg-card transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
        active
          ? "border-foreground ring-2 ring-foreground/20 shadow-md"
          : "border-border hover:border-foreground/40"
      }`}
    >
      <div
        className={`relative w-full overflow-hidden ${
          layout.mode === "dark"
            ? "bg-gradient-to-br from-neutral-900 to-black"
            : "bg-gradient-to-br from-neutral-50 to-neutral-100"
        }`}
        style={{ height: 180 }}
      >
        {html === null ? (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
            Carregando...
          </div>
        ) : (
          <iframe
            srcDoc={html}
            sandbox=""
            title={`Preview ${layout.id}`}
            className="border-0 bg-white pointer-events-none absolute"
            style={{
              width: "600px",
              height: "800px",
              transform: "scale(0.36)",
              transformOrigin: "top center",
              left: "50%",
              marginLeft: "-300px",
              top: 0,
            }}
          />
        )}
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-10 ${
            layout.mode === "dark"
              ? "bg-gradient-to-t from-black to-transparent"
              : "bg-gradient-to-t from-white to-transparent"
          }`}
        />
      </div>
      <div className="px-2 py-1.5 flex items-center justify-between border-t">
        <span className="text-[11px] font-medium truncate">{family}</span>
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
          {layout.mode}
        </span>
      </div>
    </button>
  );
}
