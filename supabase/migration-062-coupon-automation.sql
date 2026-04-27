-- Migration 062: countdown coupon automation
-- - shelf_product_performance: daily snapshot per product (views, sales, revenue, ABC tier)
-- - promo_coupon_plans: configured coupon strategies (recurring vs one-shot)
-- - promo_active_coupons: live coupons linked to VNDA discounts/rules/codes

-- ============================================================
-- 1. shelf_product_performance — daily aggregated metrics
-- ============================================================
CREATE TABLE IF NOT EXISTS shelf_product_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,

  -- Window
  period_days INT NOT NULL DEFAULT 30,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Aggregated metrics
  views INT NOT NULL DEFAULT 0,           -- GA4 itemsViewed
  units_sold INT NOT NULL DEFAULT 0,      -- VNDA orders confirmed
  revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  cvr NUMERIC(6,4) NOT NULL DEFAULT 0,    -- units_sold / max(views,1)

  -- Classification
  abc_tier TEXT NOT NULL DEFAULT 'C' CHECK (abc_tier IN ('A','B','C')),
  -- 0..1 — high views + low cvr + low revenue = best candidate for promo
  low_rotation_score NUMERIC(5,4) NOT NULL DEFAULT 0,

  UNIQUE(workspace_id, product_id, period_days)
);

CREATE INDEX idx_shelf_perf_workspace ON shelf_product_performance(workspace_id);
CREATE INDEX idx_shelf_perf_score ON shelf_product_performance(workspace_id, low_rotation_score DESC);
CREATE INDEX idx_shelf_perf_tier ON shelf_product_performance(workspace_id, abc_tier);

ALTER TABLE shelf_product_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view perf"
  ON shelf_product_performance FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "Admins manage perf"
  ON shelf_product_performance FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('owner','admin')
  ));

-- ============================================================
-- 2. promo_coupon_plans — strategy configurations
-- ============================================================
CREATE TABLE IF NOT EXISTS promo_coupon_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,

  -- Strategy
  mode TEXT NOT NULL DEFAULT 'one_shot' CHECK (mode IN ('one_shot','recurring')),
  target TEXT NOT NULL DEFAULT 'low_cvr_high_views'
    CHECK (target IN ('tier_b','tier_c','low_cvr_high_views','manual')),
  manual_product_ids TEXT[] DEFAULT NULL,

  -- Discount range — picker assigns within this band based on score
  -- Hard ceiling 25% even if max_pct is set higher (enforced in code)
  discount_min_pct NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (discount_min_pct >= 5 AND discount_min_pct <= 25),
  discount_max_pct NUMERIC(5,2) NOT NULL DEFAULT 20 CHECK (discount_max_pct >= 5 AND discount_max_pct <= 25),

  -- Per-coupon lifecycle
  duration_hours INT NOT NULL DEFAULT 48 CHECK (duration_hours BETWEEN 1 AND 168),
  max_active_products INT NOT NULL DEFAULT 5 CHECK (max_active_products BETWEEN 1 AND 20),

  -- Recurring schedule (cron expression OR simple interval)
  recurring_cron TEXT,                    -- e.g., '0 9 * * 1' (Monday 9am UTC)
  recurring_last_run_at TIMESTAMPTZ,

  -- Safety: when true, cron only proposes (status=pending) — admin approves manually
  require_manual_approval BOOLEAN NOT NULL DEFAULT true,

  -- Badge appearance — same placeholders as other promo-tags
  badge_template TEXT NOT NULL DEFAULT '{discount}% OFF | Cupom {coupon} | Acaba em {countdown}',
  badge_bg_color TEXT NOT NULL DEFAULT '#dc2626',
  badge_text_color TEXT NOT NULL DEFAULT '#ffffff',

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_coupon_plans_ws ON promo_coupon_plans(workspace_id) WHERE enabled = true;

ALTER TABLE promo_coupon_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view coupon plans"
  ON promo_coupon_plans FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "Admins manage coupon plans"
  ON promo_coupon_plans FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('owner','admin')
  ));

-- ============================================================
-- 3. promo_active_coupons — live coupons (1 row per VNDA promotion+rule+code)
-- ============================================================
CREATE TABLE IF NOT EXISTS promo_active_coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES promo_coupon_plans(id) ON DELETE SET NULL,
  product_id TEXT NOT NULL,

  -- VNDA links
  vnda_discount_id INT,                   -- promoção mãe
  vnda_rule_id INT,                       -- a regra do produto
  vnda_coupon_code TEXT NOT NULL,         -- código que o cliente digita

  discount_pct NUMERIC(5,2) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','paused','expired','cancelled','failed')),
  status_reason TEXT,

  -- Attribution (rolled up from VNDA orders applying this coupon code)
  attributed_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  attributed_units INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now(),
  approved_at TIMESTAMPTZ,
  pushed_to_vnda_at TIMESTAMPTZ,

  UNIQUE(workspace_id, vnda_coupon_code)
);

CREATE INDEX idx_active_coupons_ws_product ON promo_active_coupons(workspace_id, product_id, status);
CREATE INDEX idx_active_coupons_status ON promo_active_coupons(status, expires_at) WHERE status IN ('pending','active');

ALTER TABLE promo_active_coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members view active coupons"
  ON promo_active_coupons FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "Admins manage active coupons"
  ON promo_active_coupons FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('owner','admin')
  ));
