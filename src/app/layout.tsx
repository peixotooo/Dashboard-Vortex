"use client";

import React, { useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { cn } from "@/lib/utils";
import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-background antialiased">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        <Topbar
          onMenuClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          collapsed={sidebarCollapsed}
        />
        <main
          className={cn(
            "min-h-[calc(100vh-4rem)] transition-all duration-300 p-6",
            sidebarCollapsed ? "ml-16" : "ml-64"
          )}
        >
          {children}
        </main>
      </body>
    </html>
  );
}
