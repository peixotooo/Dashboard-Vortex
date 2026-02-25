-- ============================================
-- Migration 003: Fix infinite recursion in RLS policies
-- EXECUTE NO SUPABASE SQL EDITOR IMEDIATAMENTE
-- ============================================
-- Problema: workspace_members SELECT policy referencia a si mesma,
-- causando "infinite recursion detected in policy for relation workspace_members"

-- 1. Criar função helper que bypassa RLS (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.get_user_workspace_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid();
$$;

-- 2. Corrigir workspace_members SELECT policy
DROP POLICY IF EXISTS "Members can view members of their workspaces" ON public.workspace_members;
CREATE POLICY "Members can view members of their workspaces"
  ON public.workspace_members FOR SELECT
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

-- 3. Corrigir workspace_members INSERT policy
DROP POLICY IF EXISTS "Admins and owners can insert members" ON public.workspace_members;
CREATE POLICY "Admins and owners can insert members"
  ON public.workspace_members FOR INSERT
  WITH CHECK (
    workspace_id IN (SELECT public.get_user_workspace_ids())
  );

-- 4. Corrigir workspace_members DELETE policy
DROP POLICY IF EXISTS "Admins and owners can delete members" ON public.workspace_members;
CREATE POLICY "Admins and owners can delete members"
  ON public.workspace_members FOR DELETE
  USING (
    workspace_id IN (SELECT public.get_user_workspace_ids())
  );

-- 5. Corrigir workspaces SELECT policy
DROP POLICY IF EXISTS "Members can view workspace" ON public.workspaces;
CREATE POLICY "Members can view workspace"
  ON public.workspaces FOR SELECT
  USING (id IN (SELECT public.get_user_workspace_ids()));

-- 6. Corrigir meta_connections SELECT/INSERT/UPDATE/DELETE policies
DROP POLICY IF EXISTS "Members can view workspace connections" ON public.meta_connections;
CREATE POLICY "Members can view workspace connections"
  ON public.meta_connections FOR SELECT
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

DROP POLICY IF EXISTS "Admins and owners can manage connections" ON public.meta_connections;
CREATE POLICY "Admins and owners can manage connections"
  ON public.meta_connections FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));

DROP POLICY IF EXISTS "Admins and owners can update connections" ON public.meta_connections;
CREATE POLICY "Admins and owners can update connections"
  ON public.meta_connections FOR UPDATE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

DROP POLICY IF EXISTS "Admins and owners can delete connections" ON public.meta_connections;
CREATE POLICY "Admins and owners can delete connections"
  ON public.meta_connections FOR DELETE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

-- 7. Corrigir meta_accounts policies
DROP POLICY IF EXISTS "Members can view workspace accounts" ON public.meta_accounts;
CREATE POLICY "Members can view workspace accounts"
  ON public.meta_accounts FOR SELECT
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

DROP POLICY IF EXISTS "Admins and owners can manage accounts" ON public.meta_accounts;
CREATE POLICY "Admins and owners can manage accounts"
  ON public.meta_accounts FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));

DROP POLICY IF EXISTS "Admins and owners can delete accounts" ON public.meta_accounts;
CREATE POLICY "Admins and owners can delete accounts"
  ON public.meta_accounts FOR DELETE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

DROP POLICY IF EXISTS "Admins and owners can update accounts" ON public.meta_accounts;
CREATE POLICY "Admins and owners can update accounts"
  ON public.meta_accounts FOR UPDATE
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));
