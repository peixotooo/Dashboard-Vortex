-- Migration 064: Smart coupon rotation — discount unit, cooldown, bandit stats.
-- Builds on 062/063. Adds:
--   - mode='smart' value (auto-approve + auto-rotate based on bandit + demand)
--   - discount_unit pct|brl|auto on plans (auto = bandit decides per coupon)
--   - cooldown_days on plans (default 7) — re-propose interval per product
--   - discount_unit + discount_value_brl on active coupons (the picked unit)
--   - coupon_bandit_stats table (per-workspace win/lose tally for pct vs brl)
--   - new audit actions: attribution_synced, bandit_recomputed, bucket_reused

-- ============================================================
-- 1. Plan-level: smart mode + discount unit + cooldown
-- ============================================================
ALTER TABLE promo_coupon_plans DROP CONSTRAINT IF EXISTS promo_coupon_plans_mode_check;
ALTER TABLE promo_coupon_plans
  ADD CONSTRAINT promo_coupon_plans_mode_check
    CHECK (mode IN ('one_shot', 'recurring', 'smart'));

ALTER TABLE promo_coupon_plans
  ADD COLUMN IF NOT EXISTS discount_unit TEXT NOT NULL DEFAULT 'pct'
    CHECK (discount_unit IN ('pct', 'brl', 'auto'));

ALTER TABLE promo_coupon_plans
  ADD COLUMN IF NOT EXISTS cooldown_days INT NOT NULL DEFAULT 7
    CHECK (cooldown_days BETWEEN 0 AND 90);

-- ============================================================
-- 2. Active coupon row: which unit was actually picked + BRL value
-- ============================================================
ALTER TABLE promo_active_coupons
  ADD COLUMN IF NOT EXISTS discount_unit TEXT NOT NULL DEFAULT 'pct'
    CHECK (discount_unit IN ('pct', 'brl'));

ALTER TABLE promo_active_coupons
  ADD COLUMN IF NOT EXISTS discount_value_brl NUMERIC(10,2);

-- ============================================================
-- 3. Audit log — register the new action values
-- ============================================================
ALTER TABLE coupon_audit_log DROP CONSTRAINT IF EXISTS coupon_audit_log_action_check;
ALTER TABLE coupon_audit_log
  ADD CONSTRAINT coupon_audit_log_action_check
    CHECK (action IN (
      'plan_created', 'plan_updated', 'plan_disabled',
      'cron_picked', 'cron_skipped',
      'approved', 'rejected', 'auto_expired',
      'vnda_create_attempt', 'vnda_create_ok', 'vnda_create_fail',
      'vnda_pause_attempt', 'vnda_pause_ok', 'vnda_pause_fail',
      'product_out_of_stock', 'product_inactive',
      'manual_pause', 'manual_resume',
      'attribution_synced', 'bandit_recomputed', 'bucket_reused'
    ));

-- ============================================================
-- 4. Bandit stats (per workspace) — tally of pct vs brl coupon outcomes
-- ============================================================
CREATE TABLE IF NOT EXISTS coupon_bandit_stats (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  pct_attempts INT NOT NULL DEFAULT 0,
  pct_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  pct_units INT NOT NULL DEFAULT 0,
  brl_attempts INT NOT NULL DEFAULT 0,
  brl_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  brl_units INT NOT NULL DEFAULT 0,
  last_recomputed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE coupon_bandit_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view bandit stats"
  ON coupon_bandit_stats FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "Admins manage bandit stats"
  ON coupon_bandit_stats FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
