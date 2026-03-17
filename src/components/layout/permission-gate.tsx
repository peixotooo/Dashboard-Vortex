"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { canAccessPath } from "@/lib/features";

export function PermissionGate({ children }: { children: React.ReactNode }) {
  const { userRole, userFeatures, loading } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();

  const hasAccess = loading || canAccessPath(pathname, userRole, userFeatures);

  useEffect(() => {
    if (!loading && !canAccessPath(pathname, userRole, userFeatures)) {
      router.replace("/");
    }
  }, [pathname, userRole, userFeatures, loading, router]);

  if (!hasAccess) return null;

  return <>{children}</>;
}
