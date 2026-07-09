"use client";

import React from "react";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccountSelector } from "@/components/settings/account-selector";
import { WorkspaceSelector } from "@/components/layout/workspace-selector";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export function Topbar() {
  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background/70 px-4 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <h1 className="hidden font-display text-sm font-semibold tracking-tight sm:block">
          Dashboard Vortex
        </h1>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("vortex:open-command"))}
          className="hidden h-8 w-52 items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground md:flex cursor-pointer"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="flex-1 truncate text-left text-xs">
            Buscar ou navegar…
          </span>
          <kbd className="pointer-events-none rounded border border-border bg-background px-1.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("vortex:open-command"))}
          className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden cursor-pointer"
          aria-label="Buscar"
        >
          <Search className="size-4" />
        </button>
        <WorkspaceSelector />
        <Separator orientation="vertical" className="h-4" />
        <AccountSelector />
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => window.location.reload()}
          className="h-7 w-7"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
