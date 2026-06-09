-- Workspace-level integration toggles.
-- Meta CAPI defaults to disabled because stores may send CAPI directly from
-- VNDA. Enabling Vortex CAPI while VNDA CAPI is active can duplicate events.

CREATE TABLE IF NOT EXISTS public.workspace_integration_settings (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  meta_capi_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.workspace_integration_settings.meta_capi_enabled IS
  'When true, Vortex sends Meta Conversions API events. Keep false if VNDA native CAPI is configured.';

INSERT INTO public.workspace_integration_settings (workspace_id, meta_capi_enabled)
SELECT id, false
FROM public.workspaces
ON CONFLICT (workspace_id) DO NOTHING;

ALTER TABLE public.workspace_integration_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members view integration settings"
  ON public.workspace_integration_settings;
CREATE POLICY "Members view integration settings"
  ON public.workspace_integration_settings FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id
      FROM public.workspace_members
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins manage integration settings"
  ON public.workspace_integration_settings;
CREATE POLICY "Admins manage integration settings"
  ON public.workspace_integration_settings FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id
      FROM public.workspace_members
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id
      FROM public.workspace_members
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );
