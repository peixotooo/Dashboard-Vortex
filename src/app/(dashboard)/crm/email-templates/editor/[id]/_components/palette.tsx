"use client";
import { Button } from "@/components/ui/button";
import { PALETTE, type BlockType } from "@/lib/email-templates/editor/schema";
import { Plus } from "lucide-react";

interface Props {
  onAdd: (type: BlockType) => void;
}

const GROUP_LABEL: Record<string, string> = {
  header: "Cabeçalho",
  content: "Conteúdo",
  commerce: "Commerce",
  structural: "Estrutura",
};

export function Palette({ onAdd }: Props) {
  const groups = (["header", "content", "commerce", "structural"] as const).map((g) => ({
    key: g,
    items: PALETTE.filter((p) => p.group === g),
  }));

  return (
    <div className="space-y-5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        Adicionar bloco
      </div>
      {groups.map((g) => (
        <div key={g.key} className="space-y-1.5">
          <div className="text-[10px] font-medium text-muted-foreground/80 uppercase tracking-wider">
            {GROUP_LABEL[g.key]}
          </div>
          <div className="space-y-1">
            {g.items.map((p) => (
              <Button
                key={p.type}
                variant="ghost"
                size="sm"
                className="w-full justify-start h-auto py-2 px-2 text-left"
                onClick={() => onAdd(p.type)}
              >
                <Plus className="w-3 h-3 shrink-0 mt-0.5 mr-2 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{p.label}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {p.description}
                  </div>
                </div>
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
