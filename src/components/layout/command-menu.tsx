"use client";

// Command palette global (⌘K / Ctrl+K): navegação instantânea por toda a
// árvore do dashboard, respeitando as mesmas permissões da sidebar.
// Abrível também via evento "vortex:open-command" (botão da topbar).

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Search, CornerDownLeft, SunMoon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFilteredNavGroups } from "@/components/layout/app-sidebar";

type PaletteEntry = {
  key: string;
  title: string;
  group: string;
  href?: string;
  action?: () => void;
  icon?: React.ComponentType<{ className?: string }>;
};

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function CommandMenu() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const navGroups = useFilteredNavGroups();

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const entries = React.useMemo<PaletteEntry[]>(() => {
    const out: PaletteEntry[] = [];
    for (const group of navGroups) {
      for (const item of group.items) {
        out.push({
          key: `${group.label}:${item.href}`,
          title: item.title,
          group: group.label,
          href: item.href,
          icon: item.icon,
        });
        for (const sub of item.items ?? []) {
          out.push({
            key: `${group.label}:${item.href}:${sub.href}:${sub.title}`,
            title: `${item.title} › ${sub.title}`,
            group: group.label,
            href: sub.href,
            icon: sub.icon ?? item.icon,
          });
        }
      }
    }
    out.push({
      key: "action:theme",
      title: "Alternar tema claro/escuro",
      group: "Ações",
      icon: SunMoon,
      action: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    });
    return out;
  }, [navGroups, resolvedTheme, setTheme]);

  const results = React.useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return entries;
    return entries.filter((e) =>
      normalize(`${e.group} ${e.title}`).includes(q)
    );
  }, [entries, query]);

  React.useEffect(() => setActive(0), [query, open]);

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("vortex:open-command", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("vortex:open-command", onOpenEvent);
    };
  }, []);

  const run = React.useCallback(
    (entry: PaletteEntry | undefined) => {
      if (!entry) return;
      setOpen(false);
      setQuery("");
      if (entry.action) entry.action();
      else if (entry.href) router.push(entry.href);
    },
    [router]
  );

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    }
  }

  React.useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Agrupa resultados preservando a ordem
  const grouped = React.useMemo(() => {
    const map = new Map<string, { entry: PaletteEntry; index: number }[]>();
    results.forEach((entry, index) => {
      const list = map.get(entry.group) ?? [];
      list.push({ entry, index });
      map.set(entry.group, list);
    });
    return Array.from(map.entries());
  }, [results]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[18%] z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border/70 bg-popover shadow-[var(--shadow-overlay)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            Buscar e navegar
          </DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b border-border/60 px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Buscar página ou ação…"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              ESC
            </kbd>
          </div>
          <div ref={listRef} className="max-h-[340px] overflow-y-auto p-2">
            {results.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                Nada encontrado para “{query}”.
              </p>
            )}
            {grouped.map(([group, items]) => (
              <div key={group}>
                <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
                  {group}
                </p>
                {items.map(({ entry, index }) => (
                  <button
                    key={entry.key}
                    data-index={index}
                    onClick={() => run(entry)}
                    onMouseMove={() => setActive(index)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      index === active
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {entry.icon && (
                      <entry.icon className="size-4 shrink-0 opacity-70" />
                    )}
                    <span className="flex-1 truncate">{entry.title}</span>
                    {index === active && (
                      <CornerDownLeft className="size-3.5 shrink-0 opacity-60" />
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
