-- Migration 039: Gift Progress Bar (Régua de Progresso de Brinde)

CREATE TABLE IF NOT EXISTS gift_bar_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT false,

  -- Threshold and gift info
  threshold NUMERIC(12,2) NOT NULL DEFAULT 299.00,
  gift_name TEXT NOT NULL DEFAULT 'brinde exclusivo',
  gift_description TEXT,
  gift_image_url TEXT,

  -- Messages (support {remaining}, {threshold}, {gift}, {total} placeholders)
  message_progress TEXT NOT NULL DEFAULT 'Faltam R$ {remaining} para ganhar {gift}!',
  message_achieved TEXT NOT NULL DEFAULT 'Parabéns! Você ganhou {gift}!',
  message_empty TEXT NOT NULL DEFAULT 'Adicione R$ {threshold} em produtos e ganhe {gift}!',

  -- Styling
  bar_color TEXT DEFAULT '#10b981',
  bar_bg_color TEXT DEFAULT '#e5e7eb',
  text_color TEXT DEFAULT '#1f2937',
  bg_color TEXT DEFAULT '#ffffff',
  achieved_bg_color TEXT DEFAULT '#ecfdf5',
  achieved_text_color TEXT DEFAULT '#065f46',
  font_size TEXT DEFAULT '14px',
  bar_height TEXT DEFAULT '8px',
  position TEXT DEFAULT 'top' CHECK (position IN ('top', 'bottom')),
  show_on_pages TEXT[] DEFAULT ARRAY['all']::TEXT[],

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- One config per workspace
  UNIQUE(workspace_id)
);

CREATE INDEX idx_gift_bar_workspace ON gift_bar_configs(workspace_id) WHERE enabled = true;

ALTER TABLE gift_bar_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view gift bar configs"
  ON gift_bar_configs FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage gift bar configs"
  ON gift_bar_configs FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
