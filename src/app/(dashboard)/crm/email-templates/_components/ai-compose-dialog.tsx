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

/** Bulking-aligned context chips. Streetwear/fitness apparel, "Respect the
 *  Hustle" tone, never institutional. */
const CONTEXT_CHIPS: Array<{ label: string; text: string }> = [
  {
    label: "Drop limitado",
    text: "Drop limitado — peça nova da coleção, tiragem curta, primeira semana de exposição. Tom autoral, não promocional.",
  },
  {
    label: "Restock best-seller",
    text: "Voltou estoque da peça mais vestida do mês. Quem perdeu na primeira leva, pega agora.",
  },
  {
    label: "Última chance",
    text: "Última chance — estoque acabando da peça top, 10% off por 48 horas.",
  },
  {
    label: "Cupom relâmpago",
    text: "Cupom relâmpago só hoje — desconto exclusivo pra quem treina, expira em 6 horas.",
  },
  {
    label: "Promoção fim de semana",
    text: "Promoção do fim de semana — seleção curada da coleção com 15% off até domingo.",
  },
  {
    label: "Black Friday",
    text: "Black Friday Bulking — 30% off em uma seleção curada da coleção, prazo até segunda.",
  },
  {
    label: "Frete grátis",
    text: "Frete grátis em todo o site neste fim de semana, sem mínimo.",
  },
  {
    label: "Combo treino",
    text: "Combo treino — camiseta + short da coleção, kit pronto pra quem leva o treino a sério.",
  },
  {
    label: "Top 1 da semana",
    text: "Top 1 da semana — peça mais vendida nos últimos 7 dias, posicionada como confirmação social.",
  },
  {
    label: "Reativação",
    text: "Reativação de cliente que sumiu por mais de 60 dias. Tom: \"sentimos sua falta\", sem desconto, foco no novo drop.",
  },
  {
    label: "Aniversário",
    text: "Aniversário do cliente — cupom de presente exclusivo válido por 7 dias.",
  },
  {
    label: "Pré-treino",
    text: "Pré-treino segunda — peça pra quem começa a semana suado, mood Respect the Hustle.",
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
  const [countdownEnabled, setCountdownEnabled] = useState(false);
  const [countdownHours, setCountdownHours] = useState(48);
  const [couponEnabled, setCouponEnabled] = useState(false);
  const [couponPct, setCouponPct] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Wizard step (1-based). Total 6 steps; the last one shows the summary +
  // Montar email button.
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 6;

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
    setCountdownEnabled(false);
    setCountdownHours(48);
    setCouponEnabled(false);
    setCouponPct(10);
    setError(null);
    setLoading(false);
    setStep(1);
  };

  // Validation per step: blocks "Próximo" until the user fills the required
  // fields. Optional steps (3, 4, 5, 6) are always valid.
  const canAdvance = (() => {
    if (step === 1) return context.trim().length >= 5;
    if (step === 2) return !!layoutId;
    return true;
  })();

  const nextStep = () => {
    if (!canAdvance) return;
    if (step < TOTAL_STEPS) setStep(step + 1);
  };
  const prevStep = () => {
    if (step > 1) setStep(step - 1);
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
          // Both toggles share the same expires_at on the backend (the
          // countdown deadline). Cupom on alone gets a default 48h timer.
          // Countdown alone gets a 0% discount block (no cupom code emitted).
          coupon:
            couponEnabled || countdownEnabled
              ? {
                  discount_percent: couponEnabled ? couponPct : 0,
                  expires_in_hours: countdownEnabled
                    ? countdownHours
                    : 48,
                }
              : undefined,
          countdown_only: !couponEnabled && countdownEnabled,
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

  const isLast = step === TOTAL_STEPS;
  const stepLabel = (() => {
    switch (step) {
      case 1: return "Contexto";
      case 2: return "Template";
      case 3: return "Produto";
      case 4: return "Tom";
      case 5: return "Countdown";
      case 6: return "Cupom";
      default: return "";
    }
  })();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-3xl max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b bg-gradient-to-br from-foreground/[0.03] via-card to-foreground/[0.06]">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <div className="w-8 h-8 rounded-lg bg-foreground text-background flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <span>Criar email com IA</span>
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {step} <span className="text-muted-foreground/60">de</span> {TOTAL_STEPS} · {stepLabel}
            </span>
          </DialogTitle>
          {/* Progress bar */}
          <div className="mt-3 grid grid-cols-6 gap-1">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
              const n = i + 1;
              return (
                <button
                  key={n}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    // Allow jumping back to any earlier step or to a step
                    // already passed (forward only if validation lets us).
                    if (n < step) setStep(n);
                    else if (n === step) return;
                    else if (canAdvance && n === step + 1) setStep(n);
                  }}
                  className={`h-1.5 rounded-full transition-colors ${
                    n <= step
                      ? "bg-foreground"
                      : "bg-border hover:bg-border/80"
                  }`}
                  aria-label={`Ir pro passo ${n}`}
                />
              );
            })}
          </div>
        </div>

        {/* Body — only the current step is rendered */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
          {/* Step 1 — Contexto */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold">Conte o contexto do email</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Em linguagem natural. A IA usa isso pra escrever subject, headline, lead e CTA.
                </p>
              </div>
              <Textarea
                rows={4}
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder='Ex: "Promoção da madrugada — 20% off só esta noite, expira em 6h"'
                disabled={loading}
                className="resize-none text-sm"
                autoFocus
              />
              <div>
                <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Ou clique num atalho
                </Label>
                <div className="flex items-center gap-1.5 flex-wrap mt-2">
                  {CONTEXT_CHIPS.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      disabled={loading}
                      onClick={() => setContext(c.text)}
                      className="inline-flex items-center gap-1 px-3 h-7 rounded-full border border-border/60 text-xs hover:border-foreground/40 hover:bg-muted/40 transition-colors disabled:opacity-50"
                    >
                      <Tag className="w-2.5 h-2.5 opacity-60" />
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2 — Template */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold">Escolha um template</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  A IA preserva a identidade visual do template — você só edita
                  copy/produto depois.
                </p>
              </div>
              {layouts.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-12 justify-center">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando templates...
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
          )}

          {/* Step 3 — Produto */}
          {step === 3 && (
            <div className="space-y-4 max-w-md">
              <div>
                <h3 className="text-base font-semibold">Produto em destaque</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Opcional. Se você não escolher, a IA pega o best-seller atual
                  do catálogo automaticamente.
                </p>
              </div>
              {product ? (
                <div className="flex items-center gap-3 border rounded-md p-3 bg-muted/30">
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="w-12 h-16 object-cover shrink-0 rounded"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{product.name}</div>
                    <div className="text-xs text-muted-foreground">
                      R$ {product.price.toFixed(2)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={() => setProduct(null)}
                    disabled={loading}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <div className="flex items-center gap-2 border rounded-md px-3 h-10 bg-background focus-within:border-foreground/40">
                    <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                    <input
                      placeholder="Buscar produto VNDA..."
                      value={productSearch}
                      onChange={(e) => {
                        setProductSearch(e.target.value);
                        setProductOpen(true);
                      }}
                      onFocus={() => setProductOpen(true)}
                      className="bg-transparent outline-none text-sm flex-1 min-w-0"
                      disabled={loading}
                    />
                  </div>
                  {productOpen && productResults.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full bg-background border rounded-md shadow-lg max-h-60 overflow-y-auto">
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
                            className="w-8 h-10 object-cover shrink-0"
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
          )}

          {/* Step 4 — Tom */}
          {step === 4 && (
            <div className="space-y-4 max-w-md">
              <div>
                <h3 className="text-base font-semibold">Tom de voz</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Opcional. Modula como a IA escreve a copy. Sem seleção, usa o
                  tom padrão Bulking.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {TONES.map((t) => (
                  <Button
                    key={t.id}
                    size="lg"
                    variant={tone === t.id ? "default" : "outline"}
                    className="h-12 text-sm"
                    disabled={loading}
                    onClick={() => setTone(tone === t.id ? null : t.id)}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Step 5 — Countdown */}
          {step === 5 && (
            <div className="space-y-4 max-w-md">
              <div>
                <h3 className="text-base font-semibold">Countdown</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Adiciona um GIF animado de contagem regressiva no topo do email
                  pra urgência. Opcional.
                </p>
              </div>
              <div className="flex items-center justify-between border rounded-lg p-3 bg-card">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">
                    {countdownEnabled ? `Timer ativo · termina em ${countdownHours}h` : "Sem countdown"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {countdownEnabled
                      ? "Renderiza um GIF animado server-side."
                      : "Ative pra incluir no email."}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={countdownEnabled}
                  disabled={loading}
                  onClick={() => setCountdownEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors disabled:opacity-50 ${
                    countdownEnabled
                      ? "bg-foreground border-foreground"
                      : "bg-card border-border"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 mt-[3px] transform rounded-full bg-background transition ${
                      countdownEnabled ? "translate-x-6" : "translate-x-[3px]"
                    }`}
                  />
                </button>
              </div>
              {countdownEnabled && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Termina em (horas)</Label>
                  <Input
                    type="number"
                    value={countdownHours}
                    onChange={(e) => setCountdownHours(parseFloat(e.target.value) || 0)}
                    disabled={loading}
                    className="h-9 text-sm"
                  />
                  <div className="grid grid-cols-5 gap-1.5">
                    {[1, 6, 24, 48, 72].map((h) => (
                      <Button
                        key={h}
                        size="sm"
                        variant={countdownHours === h ? "default" : "outline"}
                        className="h-8 text-xs"
                        disabled={loading}
                        onClick={() => setCountdownHours(h)}
                      >
                        {h}h
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 6 — Cupom + summary */}
          {step === 6 && (
            <div className="space-y-5 max-w-md">
              <div>
                <h3 className="text-base font-semibold">Cupom de desconto</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Adiciona um bloco de cupom com código único e desconto.
                  Opcional.
                </p>
              </div>
              <div className="flex items-center justify-between border rounded-lg p-3 bg-card">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">
                    {couponEnabled ? `${couponPct}% off · código gerado` : "Sem cupom"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {couponEnabled
                      ? countdownEnabled
                        ? `Expira junto com o countdown (${countdownHours}h).`
                        : "Expira em 48h por padrão."
                      : "Ative pra incluir um código de desconto."}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={couponEnabled}
                  disabled={loading}
                  onClick={() => setCouponEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors disabled:opacity-50 ${
                    couponEnabled
                      ? "bg-foreground border-foreground"
                      : "bg-card border-border"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 mt-[3px] transform rounded-full bg-background transition ${
                      couponEnabled ? "translate-x-6" : "translate-x-[3px]"
                    }`}
                  />
                </button>
              </div>
              {couponEnabled && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">% de desconto</Label>
                  <Input
                    type="number"
                    value={couponPct}
                    onChange={(e) => setCouponPct(parseFloat(e.target.value) || 0)}
                    disabled={loading}
                    className="h-9 text-sm"
                  />
                  <div className="grid grid-cols-4 gap-1.5">
                    {[5, 10, 15, 20].map((p) => (
                      <Button
                        key={p}
                        size="sm"
                        variant={couponPct === p ? "default" : "outline"}
                        className="h-8 text-xs"
                        disabled={loading}
                        onClick={() => setCouponPct(p)}
                      >
                        {p}%
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Mini-resumo */}
              <div className="border-t pt-4 space-y-1.5">
                <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Resumo
                </Label>
                <div className="text-xs space-y-0.5 text-muted-foreground">
                  <div>
                    <span className="text-foreground font-medium">Contexto:</span>{" "}
                    <span className="line-clamp-1">{context.slice(0, 100)}{context.length > 100 ? "..." : ""}</span>
                  </div>
                  <div>
                    <span className="text-foreground font-medium">Template:</span>{" "}
                    <span className="font-mono">{layoutId ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-foreground font-medium">Produto:</span>{" "}
                    {product?.name ?? "automático (best-seller atual)"}
                  </div>
                  <div>
                    <span className="text-foreground font-medium">Tom:</span>{" "}
                    {tone ? TONES.find((t) => t.id === tone)?.label : "padrão Bulking"}
                  </div>
                  <div>
                    <span className="text-foreground font-medium">Countdown:</span>{" "}
                    {countdownEnabled ? `${countdownHours}h` : "não"}
                  </div>
                  <div>
                    <span className="text-foreground font-medium">Cupom:</span>{" "}
                    {couponEnabled ? `${couponPct}% off` : "não"}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sticky action bar */}
        <div className="border-t bg-card px-6 py-3 flex items-center gap-2">
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
          {!error && !loading && step === 1 && context.trim().length < 5 && (
            <div className="text-[11px] text-muted-foreground flex-1">
              Escreva pelo menos uma frase pra avançar.
            </div>
          )}
          {!error && !loading && step === 2 && !layoutId && (
            <div className="text-[11px] text-muted-foreground flex-1">
              Escolha um template pra avançar.
            </div>
          )}
          {!error && !loading && (step >= 3 && step <= 5) && (
            <div className="text-[11px] text-muted-foreground flex-1">
              Opcional · pode pular.
            </div>
          )}
          {!error && !loading && step === 6 && (
            <div className="text-[11px] flex-1 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-muted-foreground">Pronto pra montar.</span>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={close}
            disabled={loading}
          >
            Cancelar
          </Button>
          {step > 1 && (
            <Button variant="outline" size="sm" onClick={prevStep} disabled={loading} className="gap-1.5">
              <ArrowRight className="w-3.5 h-3.5 rotate-180" />
              Voltar
            </Button>
          )}
          {!isLast && (
            <Button
              size="sm"
              onClick={nextStep}
              disabled={loading || !canAdvance}
              className="gap-1.5"
            >
              Próximo
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          )}
          {isLast && (
            <Button size="sm" onClick={submit} disabled={loading} className="gap-1.5">
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Wand2 className="w-3.5 h-3.5" />
              )}
              Montar email
            </Button>
          )}
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
