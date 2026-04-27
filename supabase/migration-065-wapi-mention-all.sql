-- migration-065-wapi-mention-all.sql
-- Adds the optional "mention_all" flag to wapi_group_dispatches so the UI
-- can request that the worker resolves group participants and sends a
-- message that pings everyone in the destination group.

ALTER TABLE wapi_group_dispatches
  ADD COLUMN IF NOT EXISTS mention_all boolean NOT NULL DEFAULT false;

ALTER TABLE wapi_group_messages
  ADD COLUMN IF NOT EXISTS mentions_count integer;
