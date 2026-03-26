-- Migration 045: Virtual stock for on-demand products
-- Products marked as sob_demanda use Hub as stock source of truth
-- (instead of Eccosys), with auto-deduction on ML sales.

ALTER TABLE hub_products
  ADD COLUMN IF NOT EXISTS sob_demanda BOOLEAN DEFAULT FALSE;
