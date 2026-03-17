"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
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
  const [isDomainLocked, setIsDomainLocked] = useState(false);
  const supabaseRef = useRef(createClient());

  const fetchWorkspaces = useCallback(async () => {
    if (!user || !isConfigured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const supabase = supabaseRef.current;
      const { data, error } = await supabase
        .from("workspaces")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Workspace fetch error:", error);
      }

      const ws = (data || []) as Workspace[];
      setWorkspaces(ws);

      // Auto-select workspace: domain cookie > localStorage > first
      if (ws.length > 0 && !workspaceId) {
        const domainWs = getCookie("vortex_domain_workspace");
        if (domainWs && ws.find((w) => w.id === domainWs)) {
          setWorkspaceId(domainWs);
          setIsDomainLocked(true);
        } else {
          const savedId = localStorage.getItem("vortex_workspace_id");
          const validSaved = ws.find((w) => w.id === savedId);
          setWorkspaceId(validSaved ? savedId! : ws[0].id);
        }
      }
    } catch (err) {
      console.error("Workspace fetch exception:", err);
    } finally {
      setLoading(false);
    }
  }, [user, isConfigured, workspaceId]);

  const fetchMembers = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const supabase = supabaseRef.current;
      const { data, error } = await supabase
        .from("workspace_members")
        .select("*, profile:profiles(full_name)")
        .eq("workspace_id", workspaceId);

      if (error) {
        console.error("Members fetch error:", error);
      }

      setMembers((data || []) as WorkspaceMember[]);
    } catch (err) {
      console.error("Members fetch exception:", err);
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
