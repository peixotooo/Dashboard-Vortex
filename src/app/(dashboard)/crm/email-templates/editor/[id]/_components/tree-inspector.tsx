"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { LeafNode } from "@/lib/email-templates/tree/schema";
import { ProductPicker, type PickedProduct } from "./product-picker";
import { WysiwygEditor } from "./wysiwyg";
import { HeroGeneratorDialog } from "./hero-generator";
import { Trash2, Sparkles } from "lucide-react";
import { useState } from "react";

interface Props {
  node: LeafNode;
  workspaceId: string;
  /** Layout id of the draft — used by the AI hero generator to pick the
   *  layout-specific prompt in auto mode. */
  layoutId?: string;
  onChange: (patch: Partial<LeafNode>) => void;
  onRemove: () => void;
  /** Picking a product on any product-aware leaf propagates to all of them
   *  via applyProductToTree at the editor page level. */
  onPickProduct: (p: PickedProduct) => void;
}

const NODE_LABEL: Record<LeafNode["type"], string> = {
  heading: "Headline",
  text: "Texto",
  eyebrow: "Eyebrow",
  button: "Botão",
  image: "Produto",
  spacer: "Espaço",
  divider: "Divisor",
  rating: "Estrelas",
  "discount-badge": "Selo de desconto",
  coupon: "Cupom",
  countdown: "Countdown",
  "product-meta": "Preço + nome",
  "product-card": "Card de produto",
  "product-grid": "Grade de produtos",
  "slash-labels": "Slash labels",
  logo: "Logo",
};

function htmlToText(html: string): string {
  if (typeof window === "undefined") return html;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || "").trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function initialHtml(n: { html?: string; text?: string }): string {
  if (n.html && n.html.trim() !== "") return n.html;
  return n.text ? `<p>${escapeHtml(n.text)}</p>` : "<p></p>";
}

export function TreeInspector({
  node,
  workspaceId,
  layoutId,
  onChange,
  onRemove,
  onPickProduct,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {NODE_LABEL[node.type]}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      {renderFields(node, workspaceId, layoutId, onChange, onPickProduct)}
    </div>
  );
}

function renderFields(
  n: LeafNode,
  workspaceId: string,
  layoutId: string | undefined,
  onChange: (patch: Partial<LeafNode>) => void,
  onPickProduct: (p: PickedProduct) => void
) {
  switch (n.type) {
    case "heading":
      return (
        <Field label="Texto (formate selecionando)">
          <WysiwygEditor
            value={initialHtml(n)}
            sizePresets={[24, 30, 38, 48, 56, 64, 80]}
            onChange={(html) =>
              onChange({ html, text: htmlToText(html) } as Partial<LeafNode>)
            }
          />
        </Field>
      );
    case "text":
      return (
        <Field label="Texto (formate selecionando)">
          <WysiwygEditor
            value={initialHtml(n)}
            sizePresets={[13, 14, 15, 16, 18, 20, 24]}
            onChange={(html) =>
              onChange({ html, text: htmlToText(html) } as Partial<LeafNode>)
            }
          />
        </Field>
      );
    case "eyebrow":
      return (
        <Field label="Texto (formate selecionando)">
          <WysiwygEditor
            value={initialHtml(n)}
            singleLine
            sizePresets={[10, 11, 12, 13, 14, 16]}
            onChange={(html) =>
              onChange({ html, text: htmlToText(html) } as Partial<LeafNode>)
            }
          />
        </Field>
      );
    case "button":
      return (
        <>
          <Field label="Texto">
            <Input value={n.text} onChange={(e) => onChange({ text: e.target.value } as Partial<LeafNode>)} />
          </Field>
          <Field label="URL">
            <Input value={n.href} onChange={(e) => onChange({ href: e.target.value } as Partial<LeafNode>)} />
          </Field>
        </>
      );
    case "image":
      return (
        <ImageInspector
          node={n}
          workspaceId={workspaceId}
          layoutId={layoutId}
          onChange={onChange}
          onPickProduct={onPickProduct}
        />
      );
    case "logo":
      return (
        <>
          <Field label="URL da imagem">
            <Input
              value={n.image_url}
              onChange={(e) => onChange({ image_url: e.target.value } as Partial<LeafNode>)}
            />
          </Field>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Largura ({n.width ?? 148}px)</Label>
            <input
              type="range"
              min={60}
              max={300}
              step={2}
              value={n.width ?? 148}
              onChange={(e) => onChange({ width: parseInt(e.target.value, 10) } as Partial<LeafNode>)}
              className="w-full accent-foreground"
            />
            <div className="grid grid-cols-4 gap-1.5 pt-1">
              {[80, 120, 148, 200].map((w) => (
                <Button
                  key={w}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => onChange({ width: w } as Partial<LeafNode>)}
                >
                  {w}px
                </Button>
              ))}
            </div>
          </div>
        </>
      );
    case "product-meta":
      return (
        <>
          <ProductPicker
            workspaceId={workspaceId}
            label="Trocar produto (atualiza imagem, nome, preço e CTA do email inteiro)"
            autoLoadInitial
            onPick={onPickProduct}
          />
          <Field label="Nome">
            <Input value={n.name} onChange={(e) => onChange({ name: e.target.value } as Partial<LeafNode>)} />
          </Field>
          <Field label="Preço">
            <Input
              type="number"
              step="0.01"
              value={n.price}
              onChange={(e) => onChange({ price: parseFloat(e.target.value) || 0 } as Partial<LeafNode>)}
            />
          </Field>
          <Field label="Preço antigo (opcional)">
            <Input
              type="number"
              step="0.01"
              value={n.old_price ?? ""}
              onChange={(e) =>
                onChange({
                  old_price: e.target.value ? parseFloat(e.target.value) : undefined,
                } as Partial<LeafNode>)
              }
            />
          </Field>
        </>
      );
    case "product-card":
      return (
        <>
          <ProductPicker
            workspaceId={workspaceId}
            label="Trocar produto"
            autoLoadInitial
            onPick={(p) =>
              onChange({
                product: {
                  vnda_id: p.vnda_id,
                  name: p.name,
                  price: p.price,
                  old_price: p.old_price,
                  image_url: p.image_url,
                  url: p.url,
                },
              } as Partial<LeafNode>)
            }
          />
          <Field label="Texto do botão">
            <Input
              value={n.button_text ?? "Ver produto"}
              onChange={(e) => onChange({ button_text: e.target.value } as Partial<LeafNode>)}
            />
          </Field>
        </>
      );
    case "product-grid":
      return (
        <>
          <Field label="Colunas">
            <div className="grid grid-cols-3 gap-1">
              {[2, 3, 4].map((c) => (
                <Button
                  key={c}
                  size="sm"
                  variant={n.columns === c ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => onChange({ columns: c as 2 | 3 | 4 } as Partial<LeafNode>)}
                >
                  {c} cols
                </Button>
              ))}
            </div>
          </Field>
          <Field label="Numerar items">
            <div className="grid grid-cols-2 gap-1">
              <Button
                size="sm"
                variant={n.numbered ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => onChange({ numbered: true } as Partial<LeafNode>)}
              >
                Sim
              </Button>
              <Button
                size="sm"
                variant={!n.numbered ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => onChange({ numbered: false } as Partial<LeafNode>)}
              >
                Não
              </Button>
            </div>
          </Field>
          <div className="text-[11px] text-muted-foreground">
            {n.products.length} produto(s) na grade. Use o picker abaixo pra adicionar.
          </div>
          <ProductPicker
            workspaceId={workspaceId}
            label="Adicionar produto"
            autoLoadInitial
            onPick={(p) =>
              onChange({
                products: [
                  ...n.products,
                  {
                    vnda_id: p.vnda_id,
                    name: p.name,
                    price: p.price,
                    old_price: p.old_price,
                    image_url: p.image_url,
                    url: p.url,
                  },
                ],
              } as Partial<LeafNode>)
            }
          />
          {n.products.length > 0 && (
            <div className="space-y-1.5">
              {n.products.map((p, idx) => (
                <div
                  key={idx + p.vnda_id}
                  className="flex items-center gap-2 border rounded-md p-2"
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
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-destructive"
                    onClick={() =>
                      onChange({
                        products: n.products.filter((_, i) => i !== idx),
                      } as Partial<LeafNode>)
                    }
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      );
    case "rating":
      return (
        <>
          <Field label="Estrelas (0-5)">
            <Input
              type="number"
              min="0"
              max="5"
              value={n.rating}
              onChange={(e) => onChange({ rating: parseFloat(e.target.value) || 0 } as Partial<LeafNode>)}
            />
          </Field>
          <Field label="Quantidade (opcional)">
            <Input
              type="number"
              value={n.count ?? ""}
              onChange={(e) =>
                onChange({ count: e.target.value ? parseInt(e.target.value, 10) : undefined } as Partial<LeafNode>)
              }
            />
          </Field>
        </>
      );
    case "discount-badge":
      return (
        <Field label="% de desconto">
          <Input
            type="number"
            value={n.discount_percent}
            onChange={(e) => onChange({ discount_percent: parseFloat(e.target.value) || 0 } as Partial<LeafNode>)}
          />
        </Field>
      );
    case "coupon":
      return (
        <>
          <Field label="Código">
            <Input value={n.code} onChange={(e) => onChange({ code: e.target.value } as Partial<LeafNode>)} />
          </Field>
          <Field label="% de desconto">
            <Input
              type="number"
              value={n.discount_percent}
              onChange={(e) => onChange({ discount_percent: parseFloat(e.target.value) || 0 } as Partial<LeafNode>)}
            />
          </Field>
          <Field label="Produto vinculado">
            <Input
              value={n.product_name}
              onChange={(e) => onChange({ product_name: e.target.value } as Partial<LeafNode>)}
            />
          </Field>
        </>
      );
    case "countdown": {
      const expiresDate = new Date(n.expires_at);
      const remainingHours = Math.max(0, Math.round((expiresDate.getTime() - Date.now()) / 3600000));
      const setHoursFromNow = (h: number) =>
        onChange({ expires_at: new Date(Date.now() + h * 3600000).toISOString() } as Partial<LeafNode>);
      const localValue = (() => {
        const d = expiresDate;
        const pad = (x: number) => String(x).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      })();
      return (
        <>
          <Field label={`Termina em ${remainingHours}h`}>
            <Input
              type="number"
              value={remainingHours}
              onChange={(e) => setHoursFromNow(parseInt(e.target.value, 10) || 0)}
            />
          </Field>
          <div className="grid grid-cols-5 gap-1">
            {[1, 6, 24, 48, 72].map((h) => (
              <Button key={h} size="sm" variant="outline" className="h-7 text-xs" onClick={() => setHoursFromNow(h)}>
                {h}h
              </Button>
            ))}
          </div>
          <Field label="Ou data/hora exata">
            <Input
              type="datetime-local"
              value={localValue}
              onChange={(e) => {
                const d = new Date(e.target.value);
                if (!Number.isNaN(d.getTime())) onChange({ expires_at: d.toISOString() } as Partial<LeafNode>);
              }}
            />
          </Field>
        </>
      );
    }
    case "spacer":
      return (
        <Field label="Altura (px)">
          <Input
            type="number"
            value={n.height}
            onChange={(e) => onChange({ height: parseInt(e.target.value, 10) || 0 } as Partial<LeafNode>)}
          />
        </Field>
      );
    case "divider":
      return <p className="text-xs text-muted-foreground">Linha horizontal. Sem opções.</p>;
    case "slash-labels":
      return (
        <Field label="Labels (separe por vírgula)">
          <Input
            value={n.labels.join(", ")}
            onChange={(e) =>
              onChange({
                labels: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              } as Partial<LeafNode>)
            }
          />
        </Field>
      );
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ImageInspector({
  node,
  workspaceId,
  layoutId,
  onChange,
  onPickProduct,
}: {
  node: Extract<LeafNode, { type: "image" }>;
  workspaceId: string;
  layoutId?: string;
  onChange: (patch: Partial<LeafNode>) => void;
  onPickProduct: (p: PickedProduct) => void;
}) {
  const [genOpen, setGenOpen] = useState(false);
  return (
    <>
      <ProductPicker
        workspaceId={workspaceId}
        label="Trocar produto (atualiza imagem, nome, preço e CTA do email inteiro)"
        autoLoadInitial
        onPick={onPickProduct}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full gap-1.5 text-xs"
        onClick={() => setGenOpen(true)}
      >
        <Sparkles className="w-3.5 h-3.5" />
        Gerar header com IA
      </Button>
      <Field label="URL da imagem (manual)">
        <Input value={node.src} onChange={(e) => onChange({ src: e.target.value } as Partial<LeafNode>)} />
      </Field>
      <Field label="Texto alternativo">
        <Input value={node.alt} onChange={(e) => onChange({ alt: e.target.value } as Partial<LeafNode>)} />
      </Field>
      <HeroGeneratorDialog
        open={genOpen}
        onClose={() => setGenOpen(false)}
        workspaceId={workspaceId}
        layoutId={layoutId}
        currentSrc={node.src}
        onGenerated={(url, alt) =>
          onChange({ src: url, alt } as Partial<LeafNode>)
        }
      />
    </>
  );
}
