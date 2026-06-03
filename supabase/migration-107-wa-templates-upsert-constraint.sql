-- Fix wa_templates upsert target used by /api/crm/whatsapp/templates.
-- Supabase/PostgREST ON CONFLICT cannot target the old partial unique index:
--   (workspace_id, meta_id) WHERE meta_id IS NOT NULL
-- A normal unique constraint still allows multiple NULL meta_id rows in Postgres,
-- while letting upsert(..., { onConflict: "workspace_id,meta_id" }) work.

DROP INDEX IF EXISTS idx_wa_templates_ws_meta;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wa_templates_workspace_meta_unique'
  ) THEN
    ALTER TABLE wa_templates
      ADD CONSTRAINT wa_templates_workspace_meta_unique
      UNIQUE (workspace_id, meta_id);
  END IF;
END $$;
