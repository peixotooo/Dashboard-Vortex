"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/lib/workspace-context";

/** Campo de parceiro com autocomplete (busca em fin_partners; permite texto livre). */
export function PartnerInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { workspace } = useWorkspace();
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<{ id: string; name: string }[]>([]);
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open || !workspace?.id || value.trim().length < 2) { setOptions([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/controladoria/meta?partners_q=${encodeURIComponent(value)}`, {
        headers: { "x-workspace-id": workspace.id }, cache: "no-store",
      })
        .then((r) => r.json())
        .then((j) => setOptions(j.partners ?? []))
        .catch(() => setOptions([]));
    }, 200);
    return () => clearTimeout(t);
  }, [value, open, workspace?.id]);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={boxRef} className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Digite para buscar ou cadastrar"
        autoComplete="off"
      />
      {open && options.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => { onChange(o.name); setOpen(false); }}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
