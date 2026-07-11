-- Migration 137: Cart recovery intelligence and immutable journey history
--
-- Additive migration. Existing rules, steps, carts and message logs remain
-- untouched. Intelligence starts in shadow mode and cannot change dispatches
-- until an admin explicitly changes the rollout configuration.

ALTER TABLE public.cart_recovery_rules
  ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS intelligence_mode TEXT NOT NULL DEFAULT 'shadow',
  ADD COLUMN IF NOT EXISTS rollout_percentage INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS holdout_percentage INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS free_shipping_threshold NUMERIC(12,2) NOT NULL DEFAULT 299,
  ADD COLUMN IF NOT EXISTS free_shipping_thresholds JSONB NOT NULL DEFAULT
    '{"Sul":299,"Sudeste":299,"Centro-Oeste":299,"Nordeste":345,"Norte":345}'::jsonb;

ALTER TABLE public.cart_recovery_rules
  ALTER COLUMN free_shipping_threshold SET DEFAULT 299;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cart_recovery_rules_intelligence_mode_check'
  ) THEN
    ALTER TABLE public.cart_recovery_rules
      ADD CONSTRAINT cart_recovery_rules_intelligence_mode_check
      CHECK (intelligence_mode IN ('shadow', 'pilot', 'active'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cart_recovery_rules_rollout_percentage_check'
  ) THEN
    ALTER TABLE public.cart_recovery_rules
      ADD CONSTRAINT cart_recovery_rules_rollout_percentage_check
      CHECK (rollout_percentage BETWEEN 0 AND 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cart_recovery_rules_holdout_percentage_check'
  ) THEN
    ALTER TABLE public.cart_recovery_rules
      ADD CONSTRAINT cart_recovery_rules_holdout_percentage_check
      CHECK (holdout_percentage BETWEEN 0 AND 50);
  END IF;
END $$;

ALTER TABLE public.cart_recovery_steps
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS strategy_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.checkout_session_rollups
  ADD COLUMN IF NOT EXISTS tracker_versions JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_cart_recovery_steps_active_rule
  ON public.cart_recovery_steps (rule_id, step_order)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS public.cart_recovery_strategy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES public.cart_recovery_rules(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'archived'
    CHECK (status IN ('draft', 'active', 'archived')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rule_id, version)
);

CREATE INDEX IF NOT EXISTS idx_cart_recovery_strategy_versions_ws
  ON public.cart_recovery_strategy_versions (workspace_id, rule_id, version DESC);

ALTER TABLE public.cart_recovery_strategy_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view cart recovery strategy versions"
  ON public.cart_recovery_strategy_versions;
CREATE POLICY "Members can view cart recovery strategy versions"
  ON public.cart_recovery_strategy_versions FOR SELECT
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

DROP POLICY IF EXISTS "Admins can manage cart recovery strategy versions"
  ON public.cart_recovery_strategy_versions;
CREATE POLICY "Admins can manage cart recovery strategy versions"
  ON public.cart_recovery_strategy_versions FOR ALL
  USING (workspace_id IN (SELECT public.get_user_admin_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT public.get_user_admin_workspace_ids()));

-- Snapshot of the latest explainable diagnosis for each cart. This table does
-- not contain message copy or secrets; evidence is operational context only.
CREATE TABLE IF NOT EXISTS public.cart_recovery_intelligence (
  cart_id UUID PRIMARY KEY REFERENCES public.abandoned_carts(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'shadow'
    CHECK (mode IN ('shadow', 'pilot', 'active')),
  lifecycle TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_label TEXT NOT NULL,
  confidence NUMERIC(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_code TEXT NOT NULL,
  action_label TEXT NOT NULL,
  action JSONB NOT NULL DEFAULT '{}'::jsonb,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cart_recovery_intelligence_ws_reason
  ON public.cart_recovery_intelligence (workspace_id, reason_code, computed_at DESC);

ALTER TABLE public.cart_recovery_intelligence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view cart recovery intelligence"
  ON public.cart_recovery_intelligence;
CREATE POLICY "Members can view cart recovery intelligence"
  ON public.cart_recovery_intelligence FOR SELECT
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

DROP POLICY IF EXISTS "Admins can manage cart recovery intelligence"
  ON public.cart_recovery_intelligence;
CREATE POLICY "Admins can manage cart recovery intelligence"
  ON public.cart_recovery_intelligence FOR ALL
  USING (workspace_id IN (SELECT public.get_user_admin_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT public.get_user_admin_workspace_ids()));

-- Append-only audit trail used by the connected journey screen. event_key
-- makes worker retries idempotent.
CREATE TABLE IF NOT EXISTS public.cart_recovery_journey_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  cart_id UUID NOT NULL REFERENCES public.abandoned_carts(id) ON DELETE CASCADE,
  step_id UUID REFERENCES public.cart_recovery_steps(id) ON DELETE SET NULL,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  channel TEXT CHECK (channel IS NULL OR channel IN ('whatsapp', 'email', 'system')),
  status TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_cart_recovery_journey_events_cart
  ON public.cart_recovery_journey_events (cart_id, occurred_at, created_at);

CREATE INDEX IF NOT EXISTS idx_cart_recovery_journey_events_ws
  ON public.cart_recovery_journey_events (workspace_id, occurred_at DESC);

ALTER TABLE public.cart_recovery_journey_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view cart recovery journey events"
  ON public.cart_recovery_journey_events;
CREATE POLICY "Members can view cart recovery journey events"
  ON public.cart_recovery_journey_events FOR SELECT
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

DROP POLICY IF EXISTS "Admins can manage cart recovery journey events"
  ON public.cart_recovery_journey_events;
CREATE POLICY "Admins can manage cart recovery journey events"
  ON public.cart_recovery_journey_events FOR ALL
  USING (workspace_id IN (SELECT public.get_user_admin_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT public.get_user_admin_workspace_ids()));

-- Stable control/treatment assignment for measuring incremental recovery.
CREATE TABLE IF NOT EXISTS public.cart_recovery_experiment_assignments (
  cart_id UUID PRIMARY KEY REFERENCES public.abandoned_carts(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  experiment_key TEXT NOT NULL,
  cohort TEXT NOT NULL CHECK (cohort IN ('control', 'treatment')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cart_recovery_experiment_ws
  ON public.cart_recovery_experiment_assignments (workspace_id, experiment_key, cohort);

ALTER TABLE public.cart_recovery_experiment_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view cart recovery experiments"
  ON public.cart_recovery_experiment_assignments;
CREATE POLICY "Members can view cart recovery experiments"
  ON public.cart_recovery_experiment_assignments FOR SELECT
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

DROP POLICY IF EXISTS "Admins can manage cart recovery experiments"
  ON public.cart_recovery_experiment_assignments;
CREATE POLICY "Admins can manage cart recovery experiments"
  ON public.cart_recovery_experiment_assignments FOR ALL
  USING (workspace_id IN (SELECT public.get_user_admin_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT public.get_user_admin_workspace_ids()));

-- Queue reserved for pilot/active rollout. Shadow mode writes diagnostics and
-- events only, so it cannot duplicate the existing recovery cron.
CREATE TABLE IF NOT EXISTS public.cart_recovery_action_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  cart_id UUID NOT NULL REFERENCES public.abandoned_carts(id) ON DELETE CASCADE,
  step_id UUID REFERENCES public.cart_recovery_steps(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  action_code TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'processing', 'sent', 'failed', 'canceled')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  locked_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_cart_recovery_action_queue_due
  ON public.cart_recovery_action_queue (scheduled_at, created_at)
  WHERE status = 'scheduled';

ALTER TABLE public.cart_recovery_action_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view cart recovery action queue"
  ON public.cart_recovery_action_queue;
CREATE POLICY "Members can view cart recovery action queue"
  ON public.cart_recovery_action_queue FOR SELECT
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

DROP POLICY IF EXISTS "Admins can manage cart recovery action queue"
  ON public.cart_recovery_action_queue;
CREATE POLICY "Admins can manage cart recovery action queue"
  ON public.cart_recovery_action_queue FOR ALL
  USING (workspace_id IN (SELECT public.get_user_admin_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT public.get_user_admin_workspace_ids()));

-- Seed a version-1 snapshot for each existing rule without changing it.
INSERT INTO public.cart_recovery_strategy_versions (
  workspace_id,
  rule_id,
  version,
  status,
  config,
  activated_at
)
SELECT
  rule.workspace_id,
  rule.id,
  1,
  'active',
  jsonb_build_object(
    'enabled', rule.enabled,
    'expire_after_hours', rule.expire_after_hours,
    'intelligence_mode', rule.intelligence_mode,
    'rollout_percentage', rule.rollout_percentage,
    'holdout_percentage', rule.holdout_percentage,
    'free_shipping_threshold', rule.free_shipping_threshold,
    'free_shipping_thresholds', rule.free_shipping_thresholds,
    'steps', COALESCE((
      SELECT jsonb_agg(to_jsonb(step) - 'workspace_id' - 'rule_id' ORDER BY step.step_order)
      FROM public.cart_recovery_steps step
      WHERE step.rule_id = rule.id AND step.active = true
    ), '[]'::jsonb)
  ),
  now()
FROM public.cart_recovery_rules rule
ON CONFLICT (rule_id, version) DO NOTHING;

-- Saves a rule and its steps in one transaction. Existing step ids are kept,
-- removed steps are archived, and the previous strategy snapshot remains
-- available for audit. The function is service-role only because membership
-- and admin authorization happen in the API route before this RPC is called.
CREATE OR REPLACE FUNCTION public.save_cart_recovery_rule_version(
  p_workspace_id UUID,
  p_enabled BOOLEAN,
  p_expire_after_hours INTEGER,
  p_steps JSONB,
  p_actor UUID DEFAULT NULL
)
RETURNS TABLE (rule_id UUID, version INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule public.cart_recovery_rules%ROWTYPE;
  v_step JSONB;
  v_step_id UUID;
  v_candidate_id UUID;
  v_keep_ids UUID[] := ARRAY[]::UUID[];
  v_config JSONB;
BEGIN
  INSERT INTO public.cart_recovery_rules (
    workspace_id,
    enabled,
    expire_after_hours,
    current_version,
    updated_at
  )
  VALUES (
    p_workspace_id,
    COALESCE(p_enabled, false),
    GREATEST(1, COALESCE(p_expire_after_hours, 168)),
    1,
    now()
  )
  ON CONFLICT (workspace_id) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    expire_after_hours = EXCLUDED.expire_after_hours,
    current_version = public.cart_recovery_rules.current_version + 1,
    updated_at = now()
  RETURNING * INTO v_rule;

  FOR v_step IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_steps, '[]'::jsonb))
  LOOP
    v_candidate_id := NULL;
    BEGIN
      v_candidate_id := NULLIF(v_step ->> 'id', '')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      v_candidate_id := NULL;
    END;

    IF v_candidate_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.cart_recovery_steps existing
      WHERE existing.id = v_candidate_id
        AND existing.rule_id = v_rule.id
        AND existing.workspace_id = p_workspace_id
    ) THEN
      UPDATE public.cart_recovery_steps SET
        step_order = GREATEST(1, COALESCE((v_step ->> 'step_order')::INTEGER, 1)),
        delay_minutes = GREATEST(0, COALESCE((v_step ->> 'delay_minutes')::INTEGER, 0)),
        whatsapp_enabled = COALESCE((v_step ->> 'whatsapp_enabled')::BOOLEAN, false),
        whatsapp_template_id = NULLIF(v_step ->> 'whatsapp_template_id', '')::UUID,
        whatsapp_variable_mapping = COALESCE(v_step -> 'whatsapp_variable_mapping', '{}'::jsonb),
        email_enabled = COALESCE((v_step ->> 'email_enabled')::BOOLEAN, false),
        email_subject = NULLIF(v_step ->> 'email_subject', ''),
        email_body_html = NULLIF(v_step ->> 'email_body_html', ''),
        coupon_pct = LEAST(100, GREATEST(0, COALESCE((v_step ->> 'coupon_pct')::NUMERIC, 0))),
        coupon_validity_hours = GREATEST(1, COALESCE((v_step ->> 'coupon_validity_hours')::INTEGER, 48)),
        active = true,
        archived_at = NULL,
        strategy_version = v_rule.current_version,
        updated_at = now()
      WHERE id = v_candidate_id
      RETURNING id INTO v_step_id;
    ELSE
      INSERT INTO public.cart_recovery_steps (
        workspace_id,
        rule_id,
        step_order,
        delay_minutes,
        whatsapp_enabled,
        whatsapp_template_id,
        whatsapp_variable_mapping,
        email_enabled,
        email_subject,
        email_body_html,
        coupon_pct,
        coupon_validity_hours,
        active,
        strategy_version
      )
      VALUES (
        p_workspace_id,
        v_rule.id,
        GREATEST(1, COALESCE((v_step ->> 'step_order')::INTEGER, 1)),
        GREATEST(0, COALESCE((v_step ->> 'delay_minutes')::INTEGER, 0)),
        COALESCE((v_step ->> 'whatsapp_enabled')::BOOLEAN, false),
        NULLIF(v_step ->> 'whatsapp_template_id', '')::UUID,
        COALESCE(v_step -> 'whatsapp_variable_mapping', '{}'::jsonb),
        COALESCE((v_step ->> 'email_enabled')::BOOLEAN, false),
        NULLIF(v_step ->> 'email_subject', ''),
        NULLIF(v_step ->> 'email_body_html', ''),
        LEAST(100, GREATEST(0, COALESCE((v_step ->> 'coupon_pct')::NUMERIC, 0))),
        GREATEST(1, COALESCE((v_step ->> 'coupon_validity_hours')::INTEGER, 48)),
        true,
        v_rule.current_version
      )
      RETURNING id INTO v_step_id;
    END IF;

    v_keep_ids := array_append(v_keep_ids, v_step_id);
  END LOOP;

  UPDATE public.cart_recovery_steps archived_step SET
    active = false,
    archived_at = now(),
    updated_at = now()
  WHERE archived_step.rule_id = v_rule.id
    AND archived_step.active = true
    AND (
      cardinality(v_keep_ids) = 0
      OR NOT (archived_step.id = ANY(v_keep_ids))
    );

  UPDATE public.cart_recovery_strategy_versions version_row
  SET status = 'archived'
  WHERE version_row.rule_id = v_rule.id AND version_row.status = 'active';

  SELECT jsonb_build_object(
    'enabled', v_rule.enabled,
    'expire_after_hours', v_rule.expire_after_hours,
    'intelligence_mode', v_rule.intelligence_mode,
    'rollout_percentage', v_rule.rollout_percentage,
    'holdout_percentage', v_rule.holdout_percentage,
    'free_shipping_threshold', v_rule.free_shipping_threshold,
    'free_shipping_thresholds', v_rule.free_shipping_thresholds,
    'steps', COALESCE(jsonb_agg(
      to_jsonb(step) - 'workspace_id' - 'rule_id'
      ORDER BY step.step_order
    ), '[]'::jsonb)
  )
  INTO v_config
  FROM public.cart_recovery_steps step
  WHERE step.rule_id = v_rule.id AND step.active = true;

  INSERT INTO public.cart_recovery_strategy_versions (
    workspace_id,
    rule_id,
    version,
    status,
    config,
    created_by,
    activated_at
  ) VALUES (
    p_workspace_id,
    v_rule.id,
    v_rule.current_version,
    'active',
    v_config,
    p_actor,
    now()
  );

  RETURN QUERY SELECT v_rule.id, v_rule.current_version;
END;
$$;

REVOKE ALL ON FUNCTION public.save_cart_recovery_rule_version(
  UUID, BOOLEAN, INTEGER, JSONB, UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_cart_recovery_rule_version(
  UUID, BOOLEAN, INTEGER, JSONB, UUID
) TO service_role;
