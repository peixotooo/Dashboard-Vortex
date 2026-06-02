-- Migration 103: daily cash floor used by the cash cockpit.
--
-- Represents the minimum daily cash generated after paid media needed to
-- cover accounts payable rhythm.

ALTER TABLE workspace_financial_settings
  ADD COLUMN IF NOT EXISTS daily_cash_floor_brl numeric DEFAULT 15500;
