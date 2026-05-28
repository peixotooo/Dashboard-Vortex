-- Migration 097: desnormaliza template_name/template_language em wa_campaigns
--
-- Motivação: wa_campaigns.template_id tem FK ON DELETE SET NULL, então
-- se um template é deletado (manualmente, ou pelo antigo bug do sync
-- que fazia DELETE+INSERT — corrigido na PR #95), o join com
-- wa_templates volta null e o details dialog perde a info de QUAL
-- template foi usado.
--
-- Denormalizar essa info no momento da criação preserva o histórico
-- pra auditoria/debug, independente do que aconteça com o template.

ALTER TABLE wa_campaigns
  ADD COLUMN IF NOT EXISTS template_name TEXT,
  ADD COLUMN IF NOT EXISTS template_language TEXT;

-- Backfill: pra campanhas existentes que ainda têm o vínculo,
-- copia o nome/idioma do template.
UPDATE wa_campaigns c
SET
  template_name = COALESCE(c.template_name, t.name),
  template_language = COALESCE(c.template_language, t.language)
FROM wa_templates t
WHERE c.template_id = t.id
  AND (c.template_name IS NULL OR c.template_language IS NULL);
