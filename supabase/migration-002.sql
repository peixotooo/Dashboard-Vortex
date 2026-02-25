-- ============================================
-- Migration 002: Contas selecionáveis + conta padrão + email no profile
-- Execute no Supabase SQL Editor
-- ============================================

-- 1. Adicionar is_default na meta_accounts
ALTER TABLE public.meta_accounts ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- 2. Adicionar email no profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

-- 3. Atualizar trigger para salvar email no signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Preencher emails dos profiles existentes
UPDATE public.profiles SET email = u.email
FROM auth.users u WHERE profiles.id = u.id AND profiles.email IS NULL;

-- 5. Policy para ver perfis de membros do mesmo workspace
CREATE POLICY "Members can view workspace member profiles"
  ON public.profiles FOR SELECT
  USING (
    id IN (
      SELECT wm.user_id FROM public.workspace_members wm
      WHERE wm.workspace_id IN (
        SELECT workspace_id FROM public.workspace_members
        WHERE user_id = auth.uid()
      )
    )
  );

-- 6. Expandir update policy de workspaces para admins
DROP POLICY IF EXISTS "Owners can update workspace" ON public.workspaces;
CREATE POLICY "Owners and admins can update workspace"
  ON public.workspaces FOR UPDATE
  USING (
    id IN (
      SELECT workspace_id FROM public.workspace_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- 7. Policy de update para meta_accounts (set default)
CREATE POLICY "Admins and owners can update accounts"
  ON public.meta_accounts FOR UPDATE
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );
