-- Migration 131: Restaura o check de role (owner/admin) nas policies que a
-- migration-003 recriou SEM ele — corrigindo escalonamento de privilégio.
--
-- Bug: migration-003 recriou as policies de INSERT/DELETE de workspace_members
-- e de INSERT/UPDATE/DELETE de meta_connections/meta_accounts usando só
-- "workspace_id IN (get_user_workspace_ids())" (qualquer MEMBRO), removendo o
-- "role IN ('owner','admin')" original do schema. Efeito: um membro comum,
-- via anon key (RLS), podia inserir uma linha em workspace_members e se
-- autopromover a owner (tomada do tenant), ou gerenciar conexões Meta.
--
-- Fix seguro: gerência de membros legítima passa por service-role (rota de
-- convite/criação de workspace = createAdminClient, bypassa RLS), então
-- restringir a RLS a owner/admin NÃO quebra o aceite de convite. Só fecha o
-- caminho de escrita direta pela anon key.

-- Helper: workspaces em que o usuário é owner/admin (SECURITY DEFINER p/ evitar
-- recursão de RLS, igual get_user_workspace_ids).
CREATE OR REPLACE FUNCTION public.get_user_admin_workspace_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT workspace_id FROM public.workspace_members
  WHERE user_id = auth.uid() AND role IN ('owner', 'admin');
$$;

-- workspace_members: só owner/admin inserem/removem membros
DROP POLICY IF EXISTS "Admins and owners can insert members" ON public.workspace_members;
CREATE POLICY "Admins and owners can insert members"
  ON public.workspace_members FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.get_user_admin_workspace_ids()));

DROP POLICY IF EXISTS "Admins and owners can delete members" ON public.workspace_members;
CREATE POLICY "Admins and owners can delete members"
  ON public.workspace_members FOR DELETE
  USING (workspace_id IN (SELECT public.get_user_admin_workspace_ids()));

-- meta_connections: só owner/admin gerenciam
DROP POLICY IF EXISTS "Admins and owners can manage connections" ON public.meta_connections;
CREATE POLICY "Admins and owners can manage connections"
  ON public.meta_connections FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.get_user_admin_workspace_ids()));

DROP POLICY IF EXISTS "Admins and owners can update connections" ON public.meta_connections;
CREATE POLICY "Admins and owners can update connections"
  ON public.meta_connections FOR UPDATE
  USING (workspace_id IN (SELECT public.get_user_admin_workspace_ids()));

DROP POLICY IF EXISTS "Admins and owners can delete connections" ON public.meta_connections;
CREATE POLICY "Admins and owners can delete connections"
  ON public.meta_connections FOR DELETE
  USING (workspace_id IN (SELECT public.get_user_admin_workspace_ids()));

-- meta_accounts: só owner/admin gerenciam
DROP POLICY IF EXISTS "Admins and owners can manage accounts" ON public.meta_accounts;
CREATE POLICY "Admins and owners can manage accounts"
  ON public.meta_accounts FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.get_user_admin_workspace_ids()));

DROP POLICY IF EXISTS "Admins and owners can update accounts" ON public.meta_accounts;
CREATE POLICY "Admins and owners can update accounts"
  ON public.meta_accounts FOR UPDATE
  USING (workspace_id IN (SELECT public.get_user_admin_workspace_ids()));

DROP POLICY IF EXISTS "Admins and owners can delete accounts" ON public.meta_accounts;
CREATE POLICY "Admins and owners can delete accounts"
  ON public.meta_accounts FOR DELETE
  USING (workspace_id IN (SELECT public.get_user_admin_workspace_ids()));
