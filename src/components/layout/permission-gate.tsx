"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { canAccessPath, getFirstAllowedRoute } from "@/lib/features";

export function PermissionGate({ children }: { children: React.ReactNode }) {
  const { userRole, userFeatures, loading } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();

  const hasAccess = loading || canAccessPath(pathname, userRole, userFeatures);

  useEffect(() => {
    if (loading) return;
    if (canAccessPath(pathname, userRole, userFeatures)) return;
    const target = getFirstAllowedRoute(userRole, userFeatures);
    if (target !== pathname) router.replace(target);
  }, [pathname, userRole, userFeatures, loading, router]);

  if (!hasAccess) return null;

  return <>{children}</>;
}
