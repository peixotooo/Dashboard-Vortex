"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
  custom_domain?: string | null;
}

interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
  features: string[] | null;
  profile?: {
    full_name: string | null;
  };
}

interface WorkspaceContextType {
  workspace: Workspace | null;
  workspaces: Workspace[];
  members: WorkspaceMember[];
  userRole: string | null;
  userFeatures: string[] | null;
  canAccess: (featureId: string) => boolean;
  loading: boolean;
  error: string | null;
  isDomainLocked: boolean;
  setWorkspaceId: (id: string) => void;
  refreshWorkspaces: () => Promise<void>;
  refreshMembers: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  workspace: null,
  workspaces: [],
  members: [],
  userRole: null,
  userFeatures: null,
  canAccess: () => true,
  loading: true,
  error: null,
  isDomainLocked: false,
  setWorkspaceId: () => {},
  refreshWorkspaces: async () => {},
  refreshMembers: async () => {},
});

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user, isConfigured } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDomainLocked, setIsDomainLocked] = useState(false);
  const workspaceIdRef = useRef("");
  const workspacesRef = useRef<Workspace[]>([]);

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  const fetchWorkspaces = useCallback(async () => {
    if (!user || !isConfigured) {
      setWorkspaces([]);
      setWorkspaceId("");
      setMembers([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/workspaces/bootstrap");
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Workspace fetch error");
      }

      const ws = (data.workspaces || []) as Workspace[];
      const domainWorkspaceId = typeof data.domainWorkspaceId === "string" ? data.domainWorkspaceId : null;
      setWorkspaces(ws);
      setError(null);

      // Auto-select workspace: resolved domain > domain cookie > current > localStorage > first
      if (ws.length > 0) {
        const currentId = workspaceIdRef.current;
        const domainWs = getCookie("vortex_domain_workspace");
        const domainResolved = domainWorkspaceId && ws.find((w) => w.id === domainWorkspaceId)
          ? domainWorkspaceId
          : domainWs && ws.find((w) => w.id === domainWs)
            ? domainWs
            : null;

        if (domainResolved) {
          setWorkspaceId(domainResolved);
          localStorage.setItem("vortex_workspace_id", domainResolved);
          setIsDomainLocked(true);
        } else if (currentId && ws.find((w) => w.id === currentId)) {
          setIsDomainLocked(false);
        } else {
          const savedId = localStorage.getItem("vortex_workspace_id");
          const validSaved = ws.find((w) => w.id === savedId);
          setWorkspaceId(validSaved ? savedId! : ws[0].id);
          setIsDomainLocked(false);
        }
      } else {
        setWorkspaceId("");
        setMembers([]);
        setIsDomainLocked(false);
      }
    } catch (err) {
      console.error("Workspace fetch exception:", err);
      setError(err instanceof Error ? err.message : "Falha ao carregar workspaces");
      if (workspacesRef.current.length === 0 || !workspaceIdRef.current) {
        setWorkspaces([]);
        setWorkspaceId("");
        setMembers([]);
        setIsDomainLocked(false);
      }
    } finally {
      setLoading(false);
    }
  }, [user, isConfigured]);

  const fetchMembers = useCallback(async () => {
    if (!workspaceId) {
      setMembers([]);
      return;
    }
    try {
      const res = await fetch(`/api/workspaces/bootstrap?workspace_id=${encodeURIComponent(workspaceId)}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Members fetch error");
      }

      setMembers((data.members || []) as WorkspaceMember[]);
    } catch (err) {
      console.error("Members fetch exception:", err);
      setMembers([]);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  useEffect(() => {
    if (workspaceId) {
      localStorage.setItem("vortex_workspace_id", workspaceId);
      fetchMembers();
    }
  }, [workspaceId, fetchMembers]);

  const workspace = workspaces.find((w) => w.id === workspaceId) || null;
  const userMember = members.find((m) => m.user_id === user?.id);
  const userRole = userMember?.role || null;
  const userFeatures = userMember?.features ?? null;

  const canAccess = useMemo(() => {
    return (featureId: string): boolean => {
      if (userRole === "owner" || userRole === "admin") return true;
      if (!userFeatures) return true;
      return userFeatures.includes(featureId);
    };
  }, [userRole, userFeatures]);

  return (
    <WorkspaceContext.Provider
      value={{
        workspace,
        workspaces,
        members,
        userRole,
        userFeatures,
        canAccess,
        loading,
        error,
        isDomainLocked,
        setWorkspaceId,
        refreshWorkspaces: fetchWorkspaces,
        refreshMembers: fetchMembers,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
