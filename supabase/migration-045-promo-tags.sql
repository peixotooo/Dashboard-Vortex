-- Migration 045: Promo Tags (Etiquetas Promocionais nos cards de produto)

CREATE TABLE IF NOT EXISTS promo_tag_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT true,

  -- Rule identification
  name TEXT NOT NULL,
  priority INT DEFAULT 0,  -- Higher = shown first when multiple rules match

  -- Matching criteria
  match_type TEXT NOT NULL CHECK (match_type IN ('tag', 'category', 'name_pattern', 'product_ids')),
  match_value TEXT NOT NULL,

  -- Badge display
  badge_text TEXT NOT NULL,
  badge_bg_color TEXT DEFAULT '#ff0000',
  badge_text_color TEXT DEFAULT '#ffffff',
  badge_font_size TEXT DEFAULT '11px',
  badge_border_radius TEXT DEFAULT '4px',
  badge_position TEXT DEFAULT 'top-left' CHECK (badge_position IN (
    'top-left', 'top-right', 'bottom-left', 'bottom-right'
  )),
  badge_padding TEXT DEFAULT '4px 8px',

  -- Page targeting
  show_on_pages TEXT[] DEFAULT ARRAY['all']::TEXT[],

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_promo_tags_workspace ON promo_tag_configs(workspace_id) WHERE enabled = true;

ALTER TABLE promo_tag_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view promo tag configs"
  ON promo_tag_configs FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage promo tag configs"
  ON promo_tag_configs FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
