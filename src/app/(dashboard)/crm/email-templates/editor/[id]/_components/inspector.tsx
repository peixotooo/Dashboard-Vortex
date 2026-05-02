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
import type { BlockNode, LogoConfig } from "@/lib/email-templates/editor/schema";
import { DEFAULT_LOGO } from "@/lib/email-templates/editor/schema";
import { Trash2 } from "lucide-react";

interface Props {
  block: BlockNode;
  onChange: (patch: Partial<BlockNode>) => void;
  onRemove: () => void;
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

export function Inspector({ block, onChange, onRemove }: Props) {
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

      {renderFields(block, onChange)}
    </div>
  );
}

function renderFields(
  block: BlockNode,
  onChange: (patch: Partial<BlockNode>) => void
) {
  switch (block.type) {
    case "hook":
      return (
        <Field label="Texto">
          <Input value={block.text} onChange={(e) => onChange({ text: e.target.value } as Partial<BlockNode>)} />
        </Field>
      );

    case "headline":
      return (
        <>
          <Field label="Texto">
            <Textarea
              rows={2}
              value={block.text}
              onChange={(e) => onChange({ text: e.target.value } as Partial<BlockNode>)}
            />
          </Field>
          <AlignField value={block.align ?? "center"} onChange={(v) => onChange({ align: v } as Partial<BlockNode>)} />
        </>
      );

    case "lead":
      return (
        <>
          <Field label="Texto">
            <Textarea
              rows={3}
              value={block.text}
              onChange={(e) => onChange({ text: e.target.value } as Partial<BlockNode>)}
            />
          </Field>
          <AlignField value={block.align ?? "center"} onChange={(v) => onChange({ align: v } as Partial<BlockNode>)} />
        </>
      );

    case "rich-text":
      return (
        <>
          <Field label="Texto (use linha em branco entre parágrafos)">
            <Textarea
              rows={6}
              value={block.text}
              onChange={(e) => onChange({ text: e.target.value } as Partial<BlockNode>)}
            />
          </Field>
          <AlignField value={block.align ?? "center"} onChange={(v) => onChange({ align: v } as Partial<BlockNode>)} />
        </>
      );

    case "hero":
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
          <Field label="Badge (opcional)">
            <Input
              value={block.badge ?? ""}
              onChange={(e) => onChange({ badge: e.target.value || undefined } as Partial<BlockNode>)}
            />
          </Field>
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
              onChange={(e) => onChange({ price: parseFloat(e.target.value) || 0 } as Partial<BlockNode>)}
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
        <p className="text-xs text-muted-foreground">
          Os 3 produtos vêm do produto-âncora do draft. Em breve: editor por slot
          dentro da grade.
        </p>
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
