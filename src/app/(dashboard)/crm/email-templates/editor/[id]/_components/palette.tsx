"use client";
import { PALETTE, type BlockType } from "@/lib/email-templates/editor/schema";
import {
  Tag,
  Image as ImageIcon,
  Heading1,
  TextQuote,
  AlignLeft,
  Star,
  MousePointerClick,
  ShoppingBag,
  LayoutGrid,
  BadgePercent,
  Ticket,
  Timer,
  MoveVertical,
  Minus,
  Shirt,
  type LucideIcon,
} from "lucide-react";

interface Props {
  onAdd: (type: BlockType) => void;
}

const ICON: Record<BlockType, LucideIcon> = {
  hook: Tag,
  hero: Shirt,
  headline: Heading1,
  lead: TextQuote,
  "rich-text": AlignLeft,
  image: ImageIcon,
  rating: Star,
  cta: MousePointerClick,
  "product-meta": ShoppingBag,
  "related-products": LayoutGrid,
  "discount-badge": BadgePercent,
  coupon: Ticket,
  countdown: Timer,
  spacer: MoveVertical,
  divider: Minus,
};

export function Palette({ onAdd }: Props) {
  return (
    <div className="space-y-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground px-1">
        Adicionar bloco
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {PALETTE.map((p) => {
          const Icon = ICON[p.type];
          return (
            <button
              key={p.type}
              onClick={() => onAdd(p.type)}
              title={p.description}
              className="group flex flex-col items-center justify-center gap-1.5 aspect-square rounded-lg border border-border/60 bg-card hover:border-foreground/40 hover:bg-muted/50 transition-colors px-1 py-2"
            >
              <Icon className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              <span className="text-[10px] leading-tight text-center text-muted-foreground group-hover:text-foreground transition-colors line-clamp-2">
                {p.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
