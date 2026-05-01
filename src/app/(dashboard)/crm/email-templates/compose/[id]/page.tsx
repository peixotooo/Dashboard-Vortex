"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Check, Sparkles, Search, Wand2, RefreshCw, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";

interface Product {
  vnda_id: string;
  name: string;
  price: number;
  old_price?: number;
  image_url: string;
  url: string;
}

const SLOT_LABEL: Record<number, string> = { 1: "Best-seller", 2: "Sem-giro", 3: "Novidade" };

const DEFAULT_HOOK: Record<number, string> = {
  1: "O top 1 da semana",
  2: "Estoque acabando",
  3: "Acabou de chegar",
};

const DEFAULT_COPY: Record<number, { subject: string; headline: string; lead: string; cta_text: string }> = {
  1: {
    subject: "A peça mais vestida da semana",
    headline: "Top 1 e dá pra ver por quê.",
    lead: "Caimento pra quem treina, design feito pra durar.",
    cta_text: "Ver na loja",
  },
  2: {
    subject: "Estoque acabando: última chance",
    headline: "Última chance pra essa.",
    lead: "Estoque acabando. Antes que ela saia da nossa grade.",
    cta_text: "Aproveitar agora",
  },
  3: {
    subject: "Acabou de chegar",
    headline: "Acabou de chegar.",
    lead: "Mesma intenção de sempre: design autoral, caimento pensado.",
    cta_text: "Conferir lançamento",
  },
};

function ProductPicker({
  workspaceId,
  value,
  onChange,
  label,
}: {
  workspaceId: string;
  value: Product | null;
  onChange: (p: Product | null) => void;
  label: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(
          `/api/crm/email-templates/vnda-search?q=${encodeURIComponent(q.trim())}`,
          { headers: { "x-workspace-id": workspaceId } }
        );
        const d = await r.json();
        setResults(d.products ?? []);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q, workspaceId]);

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {value ? (
        <div className="flex items-center gap-2 border rounded p-2">
          <img src={value.image_url} alt={value.name} className="w-10 h-12 object-cover" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{value.name}</div>
            <div className="text-xs text-muted-foreground">R$ {value.price.toFixed(2)}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            <X className="w-3 h-3" />
          </Button>
        </div>
      ) : (
        <div className="relative">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar produto VNDA pelo nome..."
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              className="h-9"
            />
          </div>
          {open && q.trim().length >= 2 && (
            <div className="absolute z-10 mt-1 w-full bg-background border rounded shadow max-h-72 overflow-y-auto">
              {loading && <div className="p-3 text-xs text-muted-foreground">Buscando...</div>}
              {!loading && results.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground">Nenhum produto.</div>
              )}
              {results.map((p) => (
                <button
                  key={p.vnda_id}
                  onClick={() => {
                    onChange(p);
                    setQ("");
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 p-2 hover:bg-muted text-left"
                >
                  <img src={p.image_url} alt={p.name} className="w-8 h-10 object-cover" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">R$ {p.price.toFixed(2)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ComposePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: layoutId } = use(params);
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? "";

  const [slot, setSlot] = useState<1 | 2 | 3>(1);
  const [primary, setPrimary] = useState<Product | null>(null);
  const [related, setRelated] = useState<(Product | null)[]>([null, null, null]);

  const [subject, setSubject] = useState(DEFAULT_COPY[1].subject);
  const [headline, setHeadline] = useState(DEFAULT_COPY[1].headline);
  const [lead, setLead] = useState(DEFAULT_COPY[1].lead);
  const [ctaText, setCtaText] = useState(DEFAULT_COPY[1].cta_text);
  const [hook, setHook] = useState(DEFAULT_HOOK[1]);

  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  const [heroMode, setHeroMode] = useState<"auto" | "manual">("auto");
  const [manualPrompt, setManualPrompt] = useState("");
  const [generatingHero, setGeneratingHero] = useState(false);
  const [heroErr, setHeroErr] = useState<string | null>(null);

  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // When slot changes, repopulate text defaults.
  useEffect(() => {
    setSubject(DEFAULT_COPY[slot].subject);
    setHeadline(DEFAULT_COPY[slot].headline);
    setLead(DEFAULT_COPY[slot].lead);
    setCtaText(DEFAULT_COPY[slot].cta_text);
    setHook(DEFAULT_HOOK[slot]);
  }, [slot]);

  const ctaUrl = primary?.url ?? "https://www.bulking.com.br";

  // Live preview render. Debounced 350ms.
  const renderRef = useRef<number | null>(null);
  const requestPreview = useCallback(() => {
    if (!primary || !workspaceId) return;
    if (renderRef.current) window.clearTimeout(renderRef.current);
    renderRef.current = window.setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const r = await fetch("/api/crm/email-templates/render", {
          method: "POST",
          headers: { "content-type": "application/json", "x-workspace-id": workspaceId },
          body: JSON.stringify({
            layout_id: layoutId,
            slot,
            product: primary,
            related_products: related.filter(Boolean),
            hero_url: heroUrl ?? undefined,
            hook,
            copy: {
              subject,
              headline,
              lead,
              cta_text: ctaText,
              cta_url: ctaUrl,
            },
          }),
        });
        const d = await r.json();
        if (d.html) setPreviewHtml(d.html);
      } finally {
        setPreviewLoading(false);
      }
    }, 350);
  }, [
    layoutId,
    workspaceId,
    slot,
    primary,
    related,
    heroUrl,
    hook,
    subject,
    headline,
    lead,
    ctaText,
    ctaUrl,
  ]);

  useEffect(() => {
    requestPreview();
    return () => {
      if (renderRef.current) window.clearTimeout(renderRef.current);
    };
  }, [requestPreview]);

  async function generateHero() {
    if (!primary || !workspaceId) return;
    setHeroErr(null);
    setGeneratingHero(true);
    try {
      const body =
        heroMode === "auto"
          ? { mode: "auto", layout_id: layoutId, slot, product: primary }
          : {
              mode: "manual",
              layout_id: layoutId,
              slot,
              product: primary,
              prompt: manualPrompt,
            };
      const r = await fetch("/api/crm/email-templates/compose-hero", {
        method: "POST",
        headers: { "content-type": "application/json", "x-workspace-id": workspaceId },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) {
        setHeroErr(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setHeroUrl(d.hero_url);
    } catch (err) {
      setHeroErr((err as Error).message);
    } finally {
      setGeneratingHero(false);
    }
  }

  async function copyHtml() {
    if (!previewHtml) return;
    await navigator.clipboard.writeText(previewHtml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!workspaceId) {
    return <div className="p-6 max-w-6xl mx-auto text-muted-foreground">Selecione um workspace.</div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div>
        <Link
          href="/crm/email-templates/library"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3 h-3" /> Voltar para a biblioteca
        </Link>
        <div className="flex items-end justify-between gap-4 mt-1">
          <div>
            <h1 className="text-2xl font-bold">Montar email</h1>
            <p className="text-muted-foreground text-sm">
              Layout: <Badge variant="secondary" className="font-mono">{layoutId}</Badge>
            </p>
          </div>
          <Button onClick={copyHtml} disabled={!previewHtml}>
            {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
            {copied ? "Copiado!" : "Copiar HTML"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Editor */}
        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Slot</Label>
              <Select value={String(slot)} onValueChange={(v) => setSlot(parseInt(v, 10) as 1 | 2 | 3)}>
                <SelectTrigger className="w-44 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3].map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      Slot {s} · {SLOT_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> Hero
              </div>
              <div className="flex border rounded text-xs">
                {(["auto", "manual"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setHeroMode(m)}
                    className={`px-3 py-1 ${heroMode === m ? "bg-foreground text-background" : ""}`}
                  >
                    {m === "auto" ? "Auto" : "Manual"}
                  </button>
                ))}
              </div>
            </div>

            {heroMode === "manual" && (
              <div className="space-y-2">
                <Label className="text-xs">Prompt customizado</Label>
                <textarea
                  className="w-full border rounded p-2 text-sm font-mono min-h-[120px]"
                  placeholder="Ex: Editorial fashion hero, fitness model wearing the product, gradient charcoal background, sans-serif label TOP 1 in 60px..."
                  value={manualPrompt}
                  onChange={(e) => setManualPrompt(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  O produto selecionado abaixo será usado como referência visual junto com o prompt.
                </p>
              </div>
            )}

            <Button
              onClick={generateHero}
              disabled={!primary || generatingHero || (heroMode === "manual" && manualPrompt.trim().length < 10)}
              className="w-full"
            >
              {generatingHero ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4 mr-2" />
              )}
              {generatingHero ? "Gerando (1-3 min)..." : heroUrl ? "Regenerar hero" : "Gerar hero"}
            </Button>

            {heroErr && <div className="text-xs text-red-500">⚠ {heroErr}</div>}

            {heroUrl && (
              <div className="border rounded overflow-hidden">
                <img src={heroUrl} alt="Hero" className="w-full h-auto block" />
              </div>
            )}
          </Card>

          <Card className="p-4 space-y-3">
            <div className="font-semibold">Produto principal</div>
            <ProductPicker
              workspaceId={workspaceId}
              value={primary}
              onChange={setPrimary}
              label="Vai estar no hero, na meta e no CTA"
            />
          </Card>

          <Card className="p-4 space-y-3">
            <div className="font-semibold">Produtos secundários (até 3)</div>
            {related.map((p, i) => (
              <ProductPicker
                key={i}
                workspaceId={workspaceId}
                value={p}
                onChange={(np) =>
                  setRelated((arr) => {
                    const copy = [...arr];
                    copy[i] = np;
                    return copy;
                  })
                }
                label={`Card ${i + 1}`}
              />
            ))}
          </Card>

          <Card className="p-4 space-y-3">
            <div className="font-semibold">Textos</div>
            <div className="space-y-2">
              <Label className="text-xs">Hook (eyebrow)</Label>
              <Input value={hook} onChange={(e) => setHook(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Subject (assunto)</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Headline</Label>
              <Input value={headline} onChange={(e) => setHeadline(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Lead</Label>
              <textarea
                className="w-full border rounded p-2 text-sm min-h-[80px]"
                value={lead}
                onChange={(e) => setLead(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">CTA texto</Label>
              <Input value={ctaText} onChange={(e) => setCtaText(e.target.value)} />
            </div>
          </Card>
        </div>

        {/* Preview */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <Card className="overflow-hidden">
            <div className="p-3 border-b text-xs text-muted-foreground flex items-center justify-between">
              <span>Preview ao vivo</span>
              {previewLoading && <span>renderizando...</span>}
            </div>
            <div className="bg-neutral-100" style={{ height: 720 }}>
              {!primary ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Selecione um produto principal pra ver o preview.
                </div>
              ) : previewHtml ? (
                <iframe
                  srcDoc={previewHtml}
                  className="w-full h-full border-0 bg-white"
                  sandbox=""
                  title="preview"
                />
              ) : (
                <div className="p-6 text-center text-sm text-muted-foreground">Carregando...</div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
