-- Migration 088: controle independente de bold no título e no texto da topbar

ALTER TABLE topbar_configs
  ADD COLUMN IF NOT EXISTS title_bold BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS message_bold BOOLEAN DEFAULT false;

COMMENT ON COLUMN topbar_configs.title_bold IS
  'Se true, o título renderiza em font-weight:700. Default true.';
COMMENT ON COLUMN topbar_configs.message_bold IS
  'Se true, o texto da mensagem renderiza em font-weight:700. Default false.';
