"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { LeafNode, AnyNode, SectionNode } from "@/lib/email-templates/tree/schema";
import { ProductPicker, type PickedProduct } from "./product-picker";

interface Props {
  node: LeafNode;
  workspaceId: string;
  onChange: (patch: Partial<LeafNode>) => void;
  onRemove: () => void;
}

const NODE_LABEL: Record<LeafNode["type"], string> = {
  heading: "Headline",
  text: "Texto",
  eyebrow: "Eyebrow",
  button: "Botão",
  image: "Imagem",
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

export function TreeInspector({ node, workspaceId, onChange, onRemove }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {NODE_LABEL[node.type]}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          Remover
        </Button>
      </div>
      {renderFields(node, workspaceId, onChange)}
    </div>
  );
}

function renderFields(
  n: LeafNode,
  workspaceId: string,
  onChange: (patch: Partial<LeafNode>) => void
) {
  switch (n.type) {
    case "heading":
    case "text":
    case "eyebrow":
      return (
        <Field label="Texto">
          <Textarea
            rows={n.type === "text" ? 4 : 2}
            value={n.text}
            onChange={(e) => onChange({ text: e.target.value } as Partial<LeafNode>)}
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
        <>
          <ProductPicker
            workspaceId={workspaceId}
            label="Trocar produto (preenche imagem + alt)"
            autoLoadInitial
            onPick={(p: PickedProduct) =>
              onChange({ src: p.image_url, alt: p.name } as Partial<LeafNode>)
            }
          />
          <Field label="URL da imagem">
            <Input value={n.src} onChange={(e) => onChange({ src: e.target.value } as Partial<LeafNode>)} />
          </Field>
          <Field label="Texto alternativo">
            <Input value={n.alt} onChange={(e) => onChange({ alt: e.target.value } as Partial<LeafNode>)} />
          </Field>
        </>
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
          <Field label={`Largura (${n.width ?? 148}px)`}>
            <input
              type="range"
              min={60}
              max={300}
              value={n.width ?? 148}
              onChange={(e) => onChange({ width: parseInt(e.target.value, 10) } as Partial<LeafNode>)}
              className="w-full accent-foreground"
            />
          </Field>
        </>
      );
    case "product-meta":
      return (
        <>
          <ProductPicker
            workspaceId={workspaceId}
            label="Trocar produto"
            autoLoadInitial
            onPick={(p: PickedProduct) =>
              onChange({
                name: p.name,
                price: p.price,
                old_price: p.old_price,
              } as Partial<LeafNode>)
            }
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
        </>
      );
    case "countdown": {
      const expiresDate = new Date(n.expires_at);
      const remainingHours = Math.max(0, Math.round((expiresDate.getTime() - Date.now()) / 3600000));
      const setHoursFromNow = (h: number) =>
        onChange({ expires_at: new Date(Date.now() + h * 3600000).toISOString() } as Partial<LeafNode>);
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
    case "product-card":
    case "product-grid":
      return (
        <p className="text-xs text-muted-foreground">
          Edição de produtos da grade em breve. Por enquanto, troque pelo painel
          de configurações ou clique nos cards individuais.
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

// ---------- Tree mutation helpers ----------

export function findLeafById(sections: SectionNode[], id: string): LeafNode | null {
  for (const s of sections) {
    for (const child of s.children) {
      if (child.type === "row") {
        for (const col of child.columns) {
          for (const leaf of col.children) {
            if (leaf.id === id) return leaf;
          }
        }
      } else {
        if (child.id === id) return child;
      }
    }
  }
  return null;
}

export function updateLeafById(
  sections: SectionNode[],
  id: string,
  patch: Partial<LeafNode>
): SectionNode[] {
  return sections.map((s) => ({
    ...s,
    children: s.children.map((child) => {
      if (child.type === "row") {
        return {
          ...child,
          columns: child.columns.map((col) => ({
            ...col,
            children: col.children.map((leaf) =>
              leaf.id === id ? ({ ...leaf, ...patch } as LeafNode) : leaf
            ),
          })),
        };
      }
      if (child.id === id) {
        return { ...child, ...patch } as LeafNode;
      }
      return child;
    }),
  }));
}

export function removeLeafById(sections: SectionNode[], id: string): SectionNode[] {
  return sections
    .map((s) => ({
      ...s,
      children: s.children
        .map((child) => {
          if (child.type === "row") {
            const cols = child.columns
              .map((col) => ({
                ...col,
                children: col.children.filter((leaf) => leaf.id !== id),
              }))
              .filter((col) => col.children.length > 0);
            return cols.length > 0 ? { ...child, columns: cols } : null;
          }
          return child.id === id ? null : child;
        })
        .filter(Boolean) as Array<LeafNode | (typeof s.children)[number]>,
    }))
    .filter((s) => s.children.length > 0) as SectionNode[];
}
