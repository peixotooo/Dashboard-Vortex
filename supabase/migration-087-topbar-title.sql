-- Migration 087: adiciona campo "title" às campanhas de topbar
-- (título destacado em bold antes da mensagem)

ALTER TABLE topbar_campaigns
  ADD COLUMN IF NOT EXISTS title TEXT;

COMMENT ON COLUMN topbar_campaigns.title IS
  'Título curto exibido em bold antes da mensagem. Opcional.';
