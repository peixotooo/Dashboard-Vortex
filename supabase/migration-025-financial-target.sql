-- Add top-down revenue target and planned cost percentages
-- Meta is now: annual_revenue_target × seasonality[month] (fixed per month)
-- PE uses configured percentages instead of rolling 30d calculations

ALTER TABLE workspace_financial_settings
  ADD COLUMN IF NOT EXISTS annual_revenue_target numeric DEFAULT 8000000,
  ADD COLUMN IF NOT EXISTS invest_pct numeric DEFAULT 12,
  ADD COLUMN IF NOT EXISTS frete_pct numeric DEFAULT 6,
  ADD COLUMN IF NOT EXISTS desconto_pct numeric DEFAULT 3;
