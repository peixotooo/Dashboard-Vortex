"use client";

import React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccountSelector } from "@/components/settings/account-selector";
import { WorkspaceSelector } from "@/components/layout/workspace-selector";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function Topbar() {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background/80 backdrop-blur-sm px-4 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <h1 className="text-sm font-semibold hidden sm:block">
          Dashboard Vortex
        </h1>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <WorkspaceSelector />
        <Separator orientation="vertical" className="h-4" />
        <AccountSelector />
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
