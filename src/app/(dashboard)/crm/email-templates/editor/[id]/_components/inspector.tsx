"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BlockNode, LogoConfig, TextStyle } from "@/lib/email-templates/editor/schema";
import { DEFAULT_LOGO } from "@/lib/email-templates/editor/schema";
import { Trash2, ChevronDown, ChevronUp, Italic, Bold } from "lucide-react";
import { useState } from "react";
import { ProductPicker, type PickedProduct } from "./product-picker";
import { WysiwygEditor } from "./wysiwyg";

function htmlToPlainText(html: string): string {
  if (typeof window === "undefined") return html;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || "").trim();
}

/** Initial HTML for the WYSIWYG: prefer block.html, otherwise wrap legacy
 *  block.text in a <p>. */
function initialHtml(block: { html?: string; text?: string }): string {
  if (block.html && block.html.trim() !== "") return block.html;
  const text = block.text ?? "";
  return text ? `<p>${escapeHtml(text)}</p>` : "<p></p>";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface Props {
  block: BlockNode;
  workspaceId: string;
  onChange: (patch: Partial<BlockNode>) => void;
  onRemove: () => void;
  /** Picking a product on hero / product-meta propagates to ALL product
   *  blocks in the draft (image, alt, name, price, CTA url). */
  onPickProduct: (p: PickedProduct) => void;
}

export function LogoInspector({
  logo,
  onChange,
  onRemove,
}: {
  logo: LogoConfig | null | undefined;
  onChange: (next: LogoConfig | null) => void;
  onRemove: () => void;
}) {
  const current = logo ?? DEFAULT_LOGO;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Logo do email
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onClick={onRemove}
          title="Remover logo (esconder cabeçalho)"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      <Field label="URL da imagem">
        <Input
          value={current.image_url}
          onChange={(e) => onChange({ ...current, image_url: e.target.value })}
        />
      </Field>
      <Field label="Texto alternativo">
        <Input
          value={current.alt}
          onChange={(e) => onChange({ ...current, alt: e.target.value })}
        />
      </Field>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground flex items-center justify-between">
          <span>Largura ({current.width}px)</span>
        </Label>
        <input
          type="range"
          min={60}
          max={300}
          step={2}
          value={current.width}
          onChange={(e) => onChange({ ...current, width: parseInt(e.target.value, 10) })}
          className="w-full accent-foreground"
        />
        <div className="grid grid-cols-4 gap-1.5 pt-1">
          {[80, 120, 148, 200].map((w) => (
            <Button
              key={w}
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => onChange({ ...current, width: w })}
            >
              {w}px
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Inspector({
  block,
  workspaceId,
  onChange,
  onRemove,
  onPickProduct,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Bloco · {block.type}
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

      {renderFields(block, workspaceId, onChange, onPickProduct)}
    </div>
  );
}

function renderFields(
  block: BlockNode,
  workspaceId: string,
  onChange: (patch: Partial<BlockNode>) => void,
  onPickProduct: (p: PickedProduct) => void
) {
  switch (block.type) {
    case "hook":
      return (
        <Field label="Texto (formate selecionando)">
          <WysiwygEditor
            value={initialHtml(block)}
            singleLine
            sizePresets={[10, 11, 12, 13, 14, 16]}
            onChange={(html) =>
              onChange({
                html,
                text: htmlToPlainText(html),
              } as Partial<BlockNode>)
            }
          />
        </Field>
      );

    case "headline":
      return (
        <>
          <Field label="Texto (formate selecionando)">
            <WysiwygEditor
              value={initialHtml(block)}
              sizePresets={[24, 30, 38, 48, 56, 64, 80]}
              onChange={(html) =>
                onChange({
                  html,
                  text: htmlToPlainText(html),
                } as Partial<BlockNode>)
              }
            />
          </Field>
          <AlignField
            value={block.align ?? "center"}
            onChange={(v) => onChange({ align: v } as Partial<BlockNode>)}
          />
        </>
      );

    case "lead":
      return (
        <>
          <Field label="Texto (formate selecionando)">
            <WysiwygEditor
              value={initialHtml(block)}
              sizePresets={[13, 14, 15, 16, 18, 20, 24]}
              onChange={(html) =>
                onChange({
                  html,
                  text: htmlToPlainText(html),
                } as Partial<BlockNode>)
              }
            />
          </Field>
          <AlignField
            value={block.align ?? "center"}
            onChange={(v) => onChange({ align: v } as Partial<BlockNode>)}
          />
        </>
      );

    case "rich-text":
      return (
        <>
          <Field label="Texto (formate selecionando)">
            <WysiwygEditor
              value={initialHtml(block)}
              sizePresets={[12, 14, 15, 16, 18, 20, 24]}
              onChange={(html) =>
                onChange({
                  html,
                  text: htmlToPlainText(html),
                } as Partial<BlockNode>)
              }
            />
          </Field>
          <AlignField
            value={block.align ?? "center"}
            onChange={(v) => onChange({ align: v } as Partial<BlockNode>)}
          />
        </>
      );

    case "hero":
      return (
        <>
          <ProductPicker
            workspaceId={workspaceId}
            label="Trocar produto (atualiza imagem, nome, preço e CTA do email inteiro)"
            autoLoadInitial
            onPick={onPickProduct}
          />
          <CollapsibleAdvanced label="Editar só este bloco">
            <Field label="URL da imagem">
              <Input
                value={block.image_url}
                onChange={(e) => onChange({ image_url: e.target.value } as Partial<BlockNode>)}
              />
            </Field>
            <Field label="Texto alternativo">
              <Input
                value={block.alt}
                onChange={(e) => onChange({ alt: e.target.value } as Partial<BlockNode>)}
              />
            </Field>
            <Field label="Badge (opcional)">
              <Input
                value={block.badge ?? ""}
                onChange={(e) =>
                  onChange({ badge: e.target.value || undefined } as Partial<BlockNode>)
                }
              />
            </Field>
          </CollapsibleAdvanced>
        </>
      );

    case "image":
      return (
        <>
          <Field label="URL da imagem">
            <Input
              value={block.image_url}
              onChange={(e) => onChange({ image_url: e.target.value } as Partial<BlockNode>)}
            />
          </Field>
          <Field label="Texto alternativo">
            <Input
              value={block.alt}
              onChange={(e) => onChange({ alt: e.target.value } as Partial<BlockNode>)}
            />
          </Field>
          <Field label="Link (opcional)">
            <Input
              value={block.href ?? ""}
              onChange={(e) => onChange({ href: e.target.value || undefined } as Partial<BlockNode>)}
            />
          </Field>
        </>
      );

    case "cta":
      return (
        <>
          <Field label="Texto do botão">
            <Input
              value={block.text}
              onChange={(e) => onChange({ text: e.target.value } as Partial<BlockNode>)}
            />
          </Field>
          <Field label="URL do botão">
            <Input
              value={block.url}
              onChange={(e) => onChange({ url: e.target.value } as Partial<BlockNode>)}
            />
          </Field>
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
          <CollapsibleAdvanced label="Editar só este bloco">
            <Field label="Nome do produto">
              <Input
                value={block.name}
                onChange={(e) => onChange({ name: e.target.value } as Partial<BlockNode>)}
              />
            </Field>
            <Field label="Preço">
              <Input
                type="number"
                step="0.01"
                value={block.price}
                onChange={(e) =>
                  onChange({ price: parseFloat(e.target.value) || 0 } as Partial<BlockNode>)
                }
              />
            </Field>
            <Field label="Preço antigo (opcional)">
              <Input
                type="number"
                step="0.01"
                value={block.old_price ?? ""}
                onChange={(e) =>
                  onChange({
                    old_price: e.target.value ? parseFloat(e.target.value) : undefined,
                  } as Partial<BlockNode>)
                }
              />
            </Field>
          </CollapsibleAdvanced>
        </>
      );

    case "rating":
      return (
        <>
          <Field label="Estrelas (0–5)">
            <Input
              type="number"
              min="0"
              max="5"
              value={block.rating}
              onChange={(e) => onChange({ rating: parseFloat(e.target.value) || 0 } as Partial<BlockNode>)}
            />
          </Field>
          <Field label="Quantidade (opcional)">
            <Input
              type="number"
              value={block.count ?? ""}
              onChange={(e) =>
                onChange({ count: e.target.value ? parseInt(e.target.value, 10) : undefined } as Partial<BlockNode>)
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
            value={block.discount_percent}
            onChange={(e) =>
              onChange({ discount_percent: parseFloat(e.target.value) || 0 } as Partial<BlockNode>)
            }
          />
        </Field>
      );

    case "coupon":
      return (
        <>
          <Field label="Código">
            <Input
              value={block.code}
              onChange={(e) => onChange({ code: e.target.value } as Partial<BlockNode>)}
            />
          </Field>
          <Field label="% de desconto">
            <Input
              type="number"
              value={block.discount_percent}
              onChange={(e) =>
                onChange({ discount_percent: parseFloat(e.target.value) || 0 } as Partial<BlockNode>)
              }
            />
          </Field>
          <Field label="Produto vinculado">
            <Input
              value={block.product_name}
              onChange={(e) => onChange({ product_name: e.target.value } as Partial<BlockNode>)}
            />
          </Field>
        </>
      );

    case "countdown":
      return <CountdownInspector block={block} onChange={onChange} />;

    case "spacer":
      return (
        <Field label="Altura (px)">
          <Input
            type="number"
            value={block.height}
            onChange={(e) => onChange({ height: parseInt(e.target.value, 10) || 0 } as Partial<BlockNode>)}
          />
        </Field>
      );

    case "divider":
      return (
        <p className="text-xs text-muted-foreground">
          Linha horizontal monocromática. Sem opções configuráveis.
        </p>
      );

    case "related-products":
      return (
        <RelatedProductsInspector
          block={block}
          workspaceId={workspaceId}
          onChange={onChange}
        />
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

function AlignField({
  value,
  onChange,
}: {
  value: "left" | "center";
  onChange: (v: "left" | "center") => void;
}) {
  return (
    <Field label="Alinhamento">
      <Select value={value} onValueChange={(v) => onChange(v as "left" | "center")}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="left">Esquerda</SelectItem>
          <SelectItem value="center">Centro</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

function CountdownInspector({
  block,
  onChange,
}: {
  block: Extract<BlockNode, { type: "countdown" }>;
  onChange: (patch: Partial<BlockNode>) => void;
}) {
  const expiresDate = new Date(block.expires_at);
  const now = Date.now();
  const remainingHours = Math.max(0, Math.round((expiresDate.getTime() - now) / 3600000));

  const setHoursFromNow = (h: number) => {
    onChange({ expires_at: new Date(Date.now() + h * 3600000).toISOString() } as Partial<BlockNode>);
  };

  // For datetime-local input value (YYYY-MM-DDTHH:mm in local tz)
  const localValue = (() => {
    const d = expiresDate;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  return (
    <>
      <Field label="Tempo restante (a partir de agora)">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min="0"
            value={remainingHours}
            onChange={(e) => setHoursFromNow(parseInt(e.target.value, 10) || 0)}
            className="w-24"
          />
          <span className="text-xs text-muted-foreground">horas</span>
        </div>
      </Field>
      <div className="grid grid-cols-4 gap-1.5">
        {[1, 6, 24, 48, 72].map((h) => (
          <Button
            key={h}
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setHoursFromNow(h)}
          >
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
            if (!Number.isNaN(d.getTime())) {
              onChange({ expires_at: d.toISOString() } as Partial<BlockNode>);
            }
          }}
        />
      </Field>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        O timer é renderizado em GIF animado a cada abertura do e-mail. Se o
        usuário abrir depois do prazo, aparece <span className="font-mono">ENCERRADO</span>.
      </p>
    </>
  );
}

function CollapsibleAdvanced({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2 pt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {label}
      </button>
      {open && <div className="space-y-3 pl-4 border-l border-border/60">{children}</div>}
    </div>
  );
}

function RelatedProductsInspector({
  block,
  workspaceId,
  onChange,
}: {
  block: Extract<BlockNode, { type: "related-products" }>;
  workspaceId: string;
  onChange: (patch: Partial<BlockNode>) => void;
}) {
  const remove = (idx: number) => {
    const next = block.products.filter((_, i) => i !== idx);
    onChange({ products: next } as Partial<BlockNode>);
  };
  const add = (p: PickedProduct) => {
    if (block.products.length >= 3) return;
    const next = [
      ...block.products,
      {
        name: p.name,
        price: p.price,
        old_price: p.old_price,
        image_url: p.image_url,
        url: p.url,
      },
    ];
    onChange({ products: next } as Partial<BlockNode>);
  };
  const replace = (idx: number, p: PickedProduct) => {
    const next = [...block.products];
    next[idx] = {
      name: p.name,
      price: p.price,
      old_price: p.old_price,
      image_url: p.image_url,
      url: p.url,
    };
    onChange({ products: next } as Partial<BlockNode>);
  };

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted-foreground">
        Até 3 produtos. Clique em um pra trocar; remova com a lixeira.
      </div>
      <div className="space-y-2">
        {block.products.map((p, idx) => (
          <RelatedSlot
            key={`${idx}-${p.image_url}`}
            product={p}
            workspaceId={workspaceId}
            onReplace={(np) => replace(idx, np)}
            onRemove={() => remove(idx)}
          />
        ))}
      </div>
      {block.products.length < 3 && (
        <ProductPicker
          workspaceId={workspaceId}
          label={`Adicionar produto (${block.products.length}/3)`}
          autoLoadInitial
          onPick={add}
        />
      )}
    </div>
  );
}

function RelatedSlot({
  product,
  workspaceId,
  onReplace,
  onRemove,
}: {
  product: { name: string; price: number; image_url: string };
  workspaceId: string;
  onReplace: (p: PickedProduct) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="border rounded-md p-2 space-y-2">
      <div className="flex items-center gap-2">
        <img
          src={product.image_url}
          alt={product.name}
          className="w-9 h-11 object-cover shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="text-xs truncate">{product.name}</div>
          <div className="text-[10px] text-muted-foreground">R$ {product.price.toFixed(2)}</div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "Fechar" : "Trocar"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
      {editing && (
        <ProductPicker
          workspaceId={workspaceId}
          autoLoadInitial
          onPick={(p) => {
            onReplace(p);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}


function TypographyControls({
  style,
  defaults,
  onChange,
}: {
  style: TextStyle | undefined;
  defaults: { size: number; weight: 300 | 400 | 500 | 600 };
  onChange: (next: TextStyle | undefined) => void;
}) {
  const cur: TextStyle = style ?? {};
  const size = cur.font_size ?? defaults.size;
  const weight = cur.font_weight ?? defaults.weight;
  const italic = !!cur.italic;
  const color = cur.color ?? "";

  const set = (patch: Partial<TextStyle>) => {
    const next = { ...cur, ...patch };
    if (
      next.font_size === defaults.size &&
      next.font_weight === defaults.weight &&
      !next.italic &&
      !next.color
    ) {
      onChange(undefined);
    } else {
      onChange(next);
    }
  };

  return (
    <div className="space-y-2 pt-1 border-t border-border/60 mt-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground pt-2">
        Tipografia
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Label className="text-[11px] text-muted-foreground">Tamanho ({size}px)</Label>
          <input
            type="range"
            min={10}
            max={80}
            step={1}
            value={size}
            onChange={(e) => set({ font_size: parseInt(e.target.value, 10) })}
            className="w-full accent-foreground"
          />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {[12, 16, 24, 38].map((s) => (
          <Button
            key={s}
            size="sm"
            variant={size === s ? "default" : "outline"}
            className="h-7 text-[11px]"
            onClick={() => set({ font_size: s })}
          >
            {s}px
          </Button>
        ))}
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Peso</Label>
        <div className="grid grid-cols-4 gap-1">
          {([300, 400, 500, 600] as const).map((w) => (
            <Button
              key={w}
              size="sm"
              variant={weight === w ? "default" : "outline"}
              className="h-7 text-[11px]"
              onClick={() => set({ font_weight: w })}
            >
              {w}
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Estilo</Label>
        <div className="grid grid-cols-2 gap-1">
          <Button
            size="sm"
            variant={italic ? "default" : "outline"}
            className="h-7 gap-1.5 text-[11px]"
            onClick={() => set({ italic: !italic })}
          >
            <Italic className="w-3 h-3" /> Itálico
          </Button>
          <Button
            size="sm"
            variant={weight === 600 ? "default" : "outline"}
            className="h-7 gap-1.5 text-[11px]"
            onClick={() => set({ font_weight: weight === 600 ? 500 : 600 })}
          >
            <Bold className="w-3 h-3" /> Bold
          </Button>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Cor</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color || "#000000"}
            onChange={(e) => set({ color: e.target.value })}
            className="w-9 h-8 rounded border border-border cursor-pointer bg-transparent"
          />
          <Input
            value={color}
            placeholder="Padrão (light/dark auto)"
            onChange={(e) => set({ color: e.target.value || undefined })}
            className="h-8 text-xs flex-1 font-mono"
          />
          {color && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => set({ color: undefined })}
              title="Voltar pro padrão"
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
