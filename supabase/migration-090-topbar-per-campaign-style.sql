-- Migration 089: estilo per-campanha (tamanho, altura, bold) + estilo customizável do countdown

-- ============================================================================
-- 1) topbar_campaigns — overrides visuais de tamanho/altura/bold
-- ============================================================================

ALTER TABLE topbar_campaigns
  ADD COLUMN IF NOT EXISTS font_size TEXT,
  ADD COLUMN IF NOT EXISTS height TEXT,
  ADD COLUMN IF NOT EXISTS title_bold BOOLEAN,
  ADD COLUMN IF NOT EXISTS message_bold BOOLEAN;

COMMENT ON COLUMN topbar_campaigns.font_size IS
  'Override do font_size da topbar_configs. NULL = herda do global.';
COMMENT ON COLUMN topbar_campaigns.height IS
  'Override da altura da topbar_configs. NULL = herda do global.';
COMMENT ON COLUMN topbar_campaigns.title_bold IS
  'Override do title_bold. NULL = herda do global.';
COMMENT ON COLUMN topbar_campaigns.message_bold IS
  'Override do message_bold. NULL = herda do global.';

-- ============================================================================
-- 2) topbar_configs — defaults do estilo do countdown
-- ============================================================================

ALTER TABLE topbar_configs
  ADD COLUMN IF NOT EXISTS countdown_bg_color TEXT DEFAULT 'rgba(255,255,255,.14)',
  ADD COLUMN IF NOT EXISTS countdown_text_color TEXT,
  ADD COLUMN IF NOT EXISTS countdown_font_weight TEXT DEFAULT '600',
  ADD COLUMN IF NOT EXISTS countdown_padding TEXT DEFAULT '3px 10px',
  ADD COLUMN IF NOT EXISTS countdown_border_radius TEXT DEFAULT '999px';

COMMENT ON COLUMN topbar_configs.countdown_bg_color IS
  'Background do badge do countdown. Default rgba(255,255,255,.14).';
COMMENT ON COLUMN topbar_configs.countdown_text_color IS
  'Cor do texto do countdown. NULL = herda text_color da topbar.';
COMMENT ON COLUMN topbar_configs.countdown_font_weight IS
  'Font-weight do countdown (normal | bold | 100-900). Default 600.';
COMMENT ON COLUMN topbar_configs.countdown_padding IS
  'Padding CSS do badge. Default "3px 10px".';
COMMENT ON COLUMN topbar_configs.countdown_border_radius IS
  'Border-radius CSS do badge. Default 999px (pílula).';

-- ============================================================================
-- 3) topbar_campaigns — overrides do estilo do countdown
-- ============================================================================

ALTER TABLE topbar_campaigns
  ADD COLUMN IF NOT EXISTS countdown_bg_color TEXT,
  ADD COLUMN IF NOT EXISTS countdown_text_color TEXT,
  ADD COLUMN IF NOT EXISTS countdown_font_weight TEXT,
  ADD COLUMN IF NOT EXISTS countdown_padding TEXT,
  ADD COLUMN IF NOT EXISTS countdown_border_radius TEXT;

COMMENT ON COLUMN topbar_campaigns.countdown_bg_color IS
  'Override do background do countdown. NULL = herda do global.';
COMMENT ON COLUMN topbar_campaigns.countdown_text_color IS
  'Override da cor do texto do countdown. NULL = herda do global.';
COMMENT ON COLUMN topbar_campaigns.countdown_font_weight IS
  'Override do font-weight do countdown. NULL = herda do global.';
COMMENT ON COLUMN topbar_campaigns.countdown_padding IS
  'Override do padding do countdown. NULL = herda do global.';
COMMENT ON COLUMN topbar_campaigns.countdown_border_radius IS
  'Override do border-radius do countdown. NULL = herda do global.';
