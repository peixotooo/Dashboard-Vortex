"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { AccountProvider } from "@/lib/account-context";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth-context";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, isConfigured } = useAuth();
  const router = useRouter();

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
          <SidebarInset>
            <Topbar />
            <div className="flex-1 p-6">{children}</div>
          </SidebarInset>
        </SidebarProvider>
      </AccountProvider>
    </WorkspaceProvider>
  );
}
