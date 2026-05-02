"use client";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Copy as CopyIcon } from "lucide-react";
import type { LeafNode, SectionNode } from "@/lib/email-templates/tree/schema";
import { flattenLeaves, type FlatLeaf } from "@/lib/email-templates/tree/mutations";

const TYPE_LABEL: Record<LeafNode["type"], string> = {
  heading: "Headline",
  text: "Texto",
  eyebrow: "Eyebrow",
  button: "Botão",
  image: "Imagem",
  spacer: "Espaço",
  divider: "Divisor",
  rating: "Estrelas",
  "discount-badge": "Selo de %",
  coupon: "Cupom",
  countdown: "Countdown",
  "product-meta": "Preço + nome",
  "product-card": "Card de produto",
  "product-grid": "Grade de produtos",
  "slash-labels": "Slash labels",
  logo: "Logo",
};

function summary(leaf: LeafNode): string {
  switch (leaf.type) {
    case "heading":
    case "text":
    case "eyebrow":
      return leaf.text.slice(0, 60);
    case "button":
      return leaf.text;
    case "image":
      return leaf.alt || leaf.src;
    case "logo":
      return `${leaf.width ?? 148}px`;
    case "product-meta":
      return `${leaf.name} · R$ ${leaf.price.toFixed(2)}`;
    case "product-card":
      return leaf.product.name;
    case "product-grid":
      return `${leaf.products.length} produtos · ${leaf.columns} cols`;
    case "rating":
      return `${leaf.rating} estrelas`;
    case "discount-badge":
      return `${leaf.discount_percent}% off`;
    case "coupon":
      return `${leaf.code} · ${leaf.discount_percent}% off`;
    case "countdown": {
      const ms = new Date(leaf.expires_at).getTime() - Date.now();
      const hours = Math.max(0, Math.round(ms / 3600000));
      return `Termina em ${hours}h`;
    }
    case "spacer":
      return `${leaf.height}px`;
    case "divider":
      return "—";
    case "slash-labels":
      return leaf.labels.join(" / ");
  }
}

function SortableLeafItem({
  flat,
  selected,
  onSelect,
  onDuplicate,
}: {
  flat: FlatLeaf;
  selected: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: flat.leaf.id,
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
        aria-label="Arrastar"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium truncate">{TYPE_LABEL[flat.leaf.type]}</div>
        <div className="text-[10px] text-muted-foreground truncate">
          {flat.breadcrumb} · {summary(flat.leaf)}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate();
        }}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
        aria-label="Duplicar"
      >
        <CopyIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface Props {
  sections: SectionNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (activeId: string, overId: string) => void;
}

export function TreeStructure({ sections, selectedId, onSelect, onDuplicate, onReorder }: Props) {
  const flat = flattenLeaves(sections);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    onReorder(String(active.id), String(over.id));
  };

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground px-1">
        {flat.length} blocos · arraste pra reordenar dentro da mesma seção
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={flat.map((f) => f.leaf.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {flat.map((f) => (
              <SortableLeafItem
                key={f.leaf.id}
                flat={f}
                selected={selectedId === f.leaf.id}
                onSelect={() => onSelect(f.leaf.id)}
                onDuplicate={() => onDuplicate(f.leaf.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
