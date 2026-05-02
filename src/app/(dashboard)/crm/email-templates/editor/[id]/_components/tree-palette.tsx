"use client";
import { TREE_PALETTE, type LeafType } from "@/lib/email-templates/tree/defaults";
import {
  Tag,
  Image as ImageIcon,
  Heading1,
  TextQuote,
  Star,
  MousePointerClick,
  ShoppingBag,
  LayoutGrid,
  BadgePercent,
  Ticket,
  Timer,
  MoveVertical,
  Minus,
  Slash,
  Box,
  Shirt,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

interface Props {
  onAdd: (type: LeafType) => void;
  onGenerateWithAI: () => void;
}

const ICON: Record<LeafType, LucideIcon> = {
  eyebrow: Tag,
  image: Shirt,
  heading: Heading1,
  text: TextQuote,
  rating: Star,
  button: MousePointerClick,
  "product-meta": ShoppingBag,
  "product-card": Box,
  "product-grid": LayoutGrid,
  "discount-badge": BadgePercent,
  coupon: Ticket,
  countdown: Timer,
  "slash-labels": Slash,
  spacer: MoveVertical,
  divider: Minus,
  logo: ImageIcon,
};

export function TreePalette({ onAdd, onGenerateWithAI }: Props) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onGenerateWithAI}
        title="Gera uma imagem-header com IA usando prompts pré-definidos ou customizados"
        className="group w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-foreground/30 bg-gradient-to-br from-foreground/5 via-card to-foreground/10 hover:border-foreground/60 hover:shadow-md transition-all"
      >
        <div className="w-9 h-9 rounded-md bg-foreground text-background flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className="text-xs font-semibold">Gerar header com IA</div>
          <div className="text-[10px] text-muted-foreground leading-tight">
            Prompts prontos ou customizado · kie.ai
          </div>
        </div>
      </button>

      <div className="space-y-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground px-1">
          Adicionar bloco
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {TREE_PALETTE.map((p) => {
            const Icon = ICON[p.type];
            return (
              <button
                key={p.type}
                type="button"
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
    </div>
  );
}
