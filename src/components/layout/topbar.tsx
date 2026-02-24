"use client";

import React from "react";
import { Menu, RefreshCw, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccountSelector } from "@/components/settings/account-selector";
import { WorkspaceSelector } from "@/components/layout/workspace-selector";
import { useAuth } from "@/lib/auth-context";

interface TopbarProps {
  onMenuClick: () => void;
  collapsed: boolean;
}

export function Topbar({ onMenuClick, collapsed }: TopbarProps) {
  const { signOut } = useAuth();

  return (
    <header
      className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card/80 backdrop-blur-sm px-6"
      style={{ marginLeft: collapsed ? 64 : 256 }}
    >
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onMenuClick}
          className="lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold hidden sm:block">
          Dashboard Vortex
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <WorkspaceSelector />
        <div className="h-6 w-px bg-border" />
        <AccountSelector />
        <Button variant="ghost" size="icon" onClick={() => window.location.reload()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={signOut} title="Sair">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
