-- Migration 115: multi-connection (multi-token) support per workspace.
--
-- A workspace can now hold MORE THAN ONE meta_connections row (e.g. tokens from
-- different Meta apps/Businesses). Each meta_accounts row already links to a
-- specific connection via connection_id, so an account is queried with the token
-- of ITS connection. This migration only adds:
--   - a hot-path index for resolveTokenForAccount() lookups
--   - an index on the connection FK
--   - an optional human label on connections (to tell them apart in Settings)
--
-- No data change: connection_id is already populated for every existing row.

ALTER TABLE meta_connections ADD COLUMN IF NOT EXISTS label TEXT;

CREATE INDEX IF NOT EXISTS idx_meta_accounts_ws_account
  ON public.meta_accounts (workspace_id, account_id);

CREATE INDEX IF NOT EXISTS idx_meta_accounts_connection
  ON public.meta_accounts (connection_id);
