-- Migration 136: agrupador de repetições (parcelas/recorrência) em fin_entries.
-- Ficou de fora da migration-135 (só existia no SDD). Aditiva, sem backfill.
-- Aplicar manualmente no Supabase (padrão do projeto).

ALTER TABLE public.fin_entries
  ADD COLUMN IF NOT EXISTS recurrence_group UUID;

CREATE INDEX IF NOT EXISTS fin_entries_recurrence
  ON public.fin_entries (workspace_id, recurrence_group)
  WHERE recurrence_group IS NOT NULL;
