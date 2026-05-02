"use client";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Copy } from "lucide-react";
import type { BlockNode } from "@/lib/email-templates/editor/schema";

interface Props {
  block: BlockNode;
  selected: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
}

const TYPE_LABEL: Record<BlockNode["type"], string> = {
  hero: "Produto",
  headline: "Headline",
  lead: "Lead",
  hook: "Eyebrow",
  cta: "Botão CTA",
  "product-meta": "Preço + nome",
  "related-products": "Grade de produtos",
  rating: "Estrelas",
  "discount-badge": "Selo de desconto",
  coupon: "Cupom",
  countdown: "Countdown",
  spacer: "Espaço",
  divider: "Divisor",
  "rich-text": "Texto livre",
  image: "Imagem",
};

function summary(block: BlockNode): string {
  switch (block.type) {
    case "hook":
    case "headline":
    case "lead":
    case "rich-text":
      return block.text.slice(0, 60);
    case "cta":
      return block.text;
    case "hero":
    case "image":
      return block.alt || block.image_url;
    case "product-meta":
      return `${block.name} · R$ ${block.price.toFixed(2)}`;
    case "rating":
      return `${block.rating} estrelas`;
    case "discount-badge":
      return `${block.discount_percent}% off`;
    case "coupon":
      return `${block.code} · ${block.discount_percent}% off`;
    case "countdown": {
      const ms = new Date(block.expires_at).getTime() - Date.now();
      const hours = Math.max(0, Math.round(ms / 3600000));
      return `Termina em ${hours}h`;
    }
    case "spacer":
      return `${block.height}px`;
    case "divider":
      return "—";
    case "related-products":
      return `${block.products.length} itens`;
  }
}

export function SortableBlock({ block, selected, onSelect, onDuplicate }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 px-3 py-2.5 rounded-md border cursor-pointer transition-colors ${
        selected
          ? "border-foreground bg-foreground/5"
          : "border-border bg-card hover:border-foreground/40"
      }`}
      onClick={onSelect}
    >
      <button
        {...listeners}
        {...attributes}
        className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing -ml-1"
        onClick={(e) => e.stopPropagation()}
        aria-label="Arrastar bloco"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium truncate">{TYPE_LABEL[block.type]}</div>
        <div className="text-[11px] text-muted-foreground truncate">{summary(block)}</div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate();
        }}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
        aria-label="Duplicar"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
