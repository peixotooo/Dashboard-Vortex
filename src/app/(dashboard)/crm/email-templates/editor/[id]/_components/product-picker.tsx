"use client";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";

export interface PickedProduct {
  vnda_id: string;
  name: string;
  price: number;
  old_price?: number;
  image_url: string;
  url: string;
}

interface Props {
  workspaceId: string;
  onPick: (p: PickedProduct) => void;
  /** Inline label above the search input */
  label?: string;
  /** Auto-load latest products when the picker opens */
  autoLoadInitial?: boolean;
}

/**
 * Compact type-ahead product picker for the editor inspector. Hits the
 * existing /api/crm/email-templates/vnda-search endpoint, which returns
 * latest in-stock products when q is empty (≥2 chars triggers a name search).
 */
export function ProductPicker({ workspaceId, onPick, label, autoLoadInitial }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<PickedProduct[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const trimmed = q.trim();
    if (trimmed.length < 2 && !autoLoadInitial) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = trimmed.length >= 2 ? `?q=${encodeURIComponent(trimmed)}` : "";
        const r = await fetch(`/api/crm/email-templates/vnda-search${params}`, {
          headers: { "x-workspace-id": workspaceId },
        });
        const d = await r.json();
        setResults(d.products ?? []);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, workspaceId, open, autoLoadInitial]);

  return (
    <div className="space-y-1">
      {label && (
        <div className="text-[11px] text-muted-foreground/90">{label}</div>
      )}
      <div className="relative">
        <div className="flex items-center gap-2 border rounded-md px-2 h-8 bg-background focus-within:border-foreground/40">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            placeholder="Buscar produto VNDA..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            className="bg-transparent outline-none text-xs flex-1 min-w-0"
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setResults([]);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {open && (results.length > 0 || loading || q.trim().length >= 2) && (
          <div className="absolute z-20 mt-1 w-full bg-background border rounded-md shadow-lg max-h-72 overflow-y-auto">
            {loading && (
              <div className="p-2 text-[11px] text-muted-foreground">Buscando...</div>
            )}
            {!loading && results.length === 0 && q.trim().length >= 2 && (
              <div className="p-2 text-[11px] text-muted-foreground">Nenhum produto.</div>
            )}
            {results.map((p) => (
              <button
                key={p.vnda_id}
                onClick={() => {
                  onPick(p);
                  setQ("");
                  setOpen(false);
                  setResults([]);
                }}
                className="w-full flex items-center gap-2 p-2 hover:bg-muted text-left"
                type="button"
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
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
