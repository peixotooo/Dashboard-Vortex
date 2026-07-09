"use client";

import * as React from "react";
import { ChevronDown, Check, X } from "lucide-react";

export type Option = { value: string; label: string; hint?: string };

/**
 * Dropdown com busca digitável (combobox). Substitui o <Select> quando a lista
 * é grande (classificações, contas). Filtra por label+hint; teclado e clique-fora.
 */
export function SearchSelect({
  value, onChange, options, placeholder = "Selecione", clearable = false, className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  clearable?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const boxRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.hint ?? "").toLowerCase().includes(q)
    );
  }, [options, query]);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setQuery(""); }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  React.useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between gap-1 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm hover:bg-muted/50"
      >
        <span className={`truncate ${selected ? "" : "text-muted-foreground"}`}>
          {selected?.label ?? placeholder}
        </span>
        <span className="flex items-center gap-1">
          {clearable && value && (
            <X
              className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onChange(""); }}
            />
          )}
          <ChevronDown className="h-4 w-4 opacity-50" />
        </span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[240px] rounded-md border bg-popover shadow-md">
          <div className="border-b p-1.5">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar…"
              className="h-8 w-full rounded bg-transparent px-2 text-sm outline-none"
            />
          </div>
          <div className="max-h-64 overflow-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">Nada encontrado.</div>
            )}
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); setQuery(""); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted ${o.value === value ? "bg-muted/60" : ""}`}
              >
                <Check className={`h-3.5 w-3.5 shrink-0 ${o.value === value ? "opacity-100" : "opacity-0"}`} />
                <span className="truncate">{o.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
