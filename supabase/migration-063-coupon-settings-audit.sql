-- Migration 063: workspace-level coupon settings + audit log.
-- Removes hard-coded discount cap from migration 062 (now configurable
-- per workspace via coupon_workspace_settings) and adds an audit table
-- so every cron action / approval / rejection / VNDA write is traceable.

-- ============================================================
-- 1. Drop hard CHECK constraints on per-plan discount range
-- ============================================================
-- Replaced by workspace-level global_max_discount_pct check at write time
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'promo_coupon_plans_discount_min_pct_check'
  ) THEN
    ALTER TABLE promo_coupon_plans DROP CONSTRAINT promo_coupon_plans_discount_min_pct_check;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'promo_coupon_plans_discount_max_pct_check'
  ) THEN
    ALTER TABLE promo_coupon_plans DROP CONSTRAINT promo_coupon_plans_discount_max_pct_check;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'promo_coupon_plans_max_active_products_check'
  ) THEN
    ALTER TABLE promo_coupon_plans DROP CONSTRAINT promo_coupon_plans_max_active_products_check;
  END IF;
END $$;

-- Replace with looser sanity limits (must be > 0, < 100%; at most 50 active)
ALTER TABLE promo_coupon_plans
  ADD CONSTRAINT promo_coupon_plans_discount_min_sane
    CHECK (discount_min_pct > 0 AND discount_min_pct < 100),
  ADD CONSTRAINT promo_coupon_plans_discount_max_sane
    CHECK (discount_max_pct > 0 AND discount_max_pct < 100 AND discount_max_pct >= discount_min_pct),
  ADD CONSTRAINT promo_coupon_plans_max_active_sane
    CHECK (max_active_products > 0 AND max_active_products <= 50);

-- ============================================================
-- 2. coupon_workspace_settings — global guardrails per workspace
-- ============================================================
CREATE TABLE IF NOT EXISTS coupon_workspace_settings (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Hard ceilings — every plan in this workspace is clamped to these values
  -- regardless of what the plan config says. Operators can raise/lower these
  -- in the dashboard.
  global_max_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 25
    CHECK (global_max_discount_pct > 0 AND global_max_discount_pct <= 80),
  global_max_active_coupons INT NOT NULL DEFAULT 30
    CHECK (global_max_active_coupons > 0 AND global_max_active_coupons <= 200),

  -- Lifecycle
  pending_approval_ttl_hours INT NOT NULL DEFAULT 48
    CHECK (pending_approval_ttl_hours BETWEEN 1 AND 168),

  -- VNDA defaults applied to every coupon we create
  default_uses_per_code INT NOT NULL DEFAULT 100 CHECK (default_uses_per_code > 0),
  default_uses_per_user INT NOT NULL DEFAULT 1 CHECK (default_uses_per_user > 0),
  -- false = our coupons cannot stack with other VNDA promos
  cumulative_with_other_promos BOOLEAN NOT NULL DEFAULT false,

  -- Operations
  notify_on_creation BOOLEAN NOT NULL DEFAULT true,
  notify_on_failure BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE coupon_workspace_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view coupon settings"
  ON coupon_workspace_settings FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "Admins manage coupon settings"
  ON coupon_workspace_settings FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('owner','admin')
  ));

-- ============================================================
-- 3. coupon_audit_log — every cron action / VNDA call / approval
-- ============================================================
-- Why a dedicated table: lets ops "what happened?" review without
-- digging Vercel logs, and survives log rotation.
CREATE TABLE IF NOT EXISTS coupon_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES promo_coupon_plans(id) ON DELETE SET NULL,
  active_coupon_id UUID REFERENCES promo_active_coupons(id) ON DELETE SET NULL,

  -- What happened
  action TEXT NOT NULL CHECK (action IN (
    'plan_created', 'plan_updated', 'plan_disabled',
    'cron_picked', 'cron_skipped',
    'approved', 'rejected', 'auto_expired',
    'vnda_create_attempt', 'vnda_create_ok', 'vnda_create_fail',
    'vnda_pause_attempt', 'vnda_pause_ok', 'vnda_pause_fail',
    'product_out_of_stock', 'product_inactive',
    'manual_pause', 'manual_resume'
  )),
  actor TEXT,                            -- 'cron' | user_id | 'system'
  product_id TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_coupon_audit_ws_recent ON coupon_audit_log(workspace_id, created_at DESC);
CREATE INDEX idx_coupon_audit_plan ON coupon_audit_log(plan_id, created_at DESC) WHERE plan_id IS NOT NULL;
CREATE INDEX idx_coupon_audit_action ON coupon_audit_log(action, created_at DESC);

ALTER TABLE coupon_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view audit log"
  ON coupon_audit_log FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "Admins write audit log"
  ON coupon_audit_log FOR INSERT
  WITH CHECK (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('owner','admin')
  ));
