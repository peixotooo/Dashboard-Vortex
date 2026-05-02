-- supabase/migration-069-suggestion-layout-id.sql
--
-- Track which layout the daily cron used per suggestion so the editor can
-- open it with the same structural identity when the user clicks "Editar".
-- Existing rows stay NULL; the to-draft endpoint falls back to "classic".

alter table email_template_suggestions
  add column if not exists layout_id text;
