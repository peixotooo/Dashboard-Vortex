"use client";

import React, { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { CommandMenu } from "@/components/layout/command-menu";
import { Topbar } from "@/components/layout/topbar";
import { AccountProvider } from "@/lib/account-context";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth-context";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { PermissionGate } from "@/components/layout/permission-gate";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, isConfigured } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isConfigured && !loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router, isConfigured]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (isConfigured && !user) {
    return null;
  }

  return (
    <WorkspaceProvider>
      <AccountProvider>
        <SidebarProvider>
          <AppSidebar />
          <CommandMenu />
          <SidebarInset className="overflow-x-clip">
            <Topbar />
            <div className="relative flex-1 overflow-x-hidden p-6">
              <div
                aria-hidden
                className="pointer-events-none absolute -top-32 left-1/3 h-72 w-[640px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -top-24 right-[-10%] hidden h-56 w-[420px] rounded-full bg-info/6 blur-[110px] dark:block"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 hidden dark:block bg-noise"
              />
              <div
                key={pathname}
                className="relative animate-in fade-in-0 slide-in-from-bottom-1 duration-300"
              >
                <PermissionGate>{children}</PermissionGate>
              </div>
            </div>
          </SidebarInset>
        </SidebarProvider>
      </AccountProvider>
    </WorkspaceProvider>
  );
}
